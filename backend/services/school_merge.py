"""school_merge.py — pure, testable fuzzy-duplicate detection for schools.

The scoring is deliberately dependency-free (no DB) so it can be unit-tested and
reasoned about in isolation. The CRM routes fetch the school list, call
``find_candidates``, and handle dismissals + the actual merge (which touches the
DB and must reuse the proven FK-reassign procedure).
"""
import re
from collections import defaultdict
from difflib import SequenceMatcher

# Noise tokens stripped from a school NAME before comparison — they carry almost
# no discriminating signal (nearly every school has some of them).
_NAME_NOISE = {
    "school", "schools", "public", "the", "sr", "senior", "sec", "secondary",
    "higher", "hr", "english", "medium", "international", "intl", "academy",
    "vidyalaya", "vidhyalaya", "vidya", "convent", "high", "pvt", "ltd", "co",
    "and", "of", "for", "school.", "sch",
}


def normalize_name(s: str) -> str:
    """Lowercase, strip punctuation, drop noise tokens, collapse whitespace."""
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    toks = [t for t in s.split() if t and t not in _NAME_NOISE]
    return " ".join(toks)


def normalize_simple(s: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace (city / address)."""
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return " ".join(s.split())


def _ratio(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def score_pair(a: dict, b: dict) -> float:
    """Weighted similarity (0..1) of two school dicts on name + city + address.

    Name dominates (0.60); city (0.25) and address (0.15) refine it.
    """
    name = _ratio(normalize_name(a.get("school_name")), normalize_name(b.get("school_name")))
    city = _ratio(normalize_simple(a.get("city")), normalize_simple(b.get("city")))
    addr = _ratio(normalize_simple(a.get("address")), normalize_simple(b.get("address")))
    return round(name * 0.60 + city * 0.25 + addr * 0.15, 4)


def block_keys(school: dict) -> list:
    """Block keys used to avoid O(n^2) comparison across the whole collection.

    A school is filed under BOTH its normalized city AND its first significant
    name token, so a candidate pair that shares EITHER is still compared. This
    keeps same-city dups (different name spacing) AND same-name dups (different
    or blank city) both discoverable.
    """
    keys = []
    nm = normalize_name(school.get("school_name"))
    if nm:
        keys.append("n:" + nm.split()[0])
    city = normalize_simple(school.get("city"))
    if city:
        keys.append("c:" + city)
    return keys or ["_none"]


def find_candidates(schools: list, threshold: float = 0.72, limit: int = 200,
                    block_cap: int = 500) -> list:
    """Return scored candidate pairs above *threshold*, highest score first.

    Args:
        schools:   list of school dicts (each must have "school_id").
        threshold: minimum blended score to surface a pair.
        limit:     max pairs returned.
        block_cap: skip pathologically large blocks (comparisons would explode);
                   such schools are still reachable via their OTHER block key.

    Returns:
        list of (score, school_a, school_b) tuples, deduped by school-id pair.
    """
    blocks = defaultdict(list)
    for s in schools:
        for k in block_keys(s):
            blocks[k].append(s)

    seen = set()
    pairs = []
    for key, group in blocks.items():
        n = len(group)
        if n < 2 or n > block_cap:
            continue
        for i in range(n):
            for j in range(i + 1, n):
                a, b = group[i], group[j]
                ida, idb = a.get("school_id"), b.get("school_id")
                if ida == idb:
                    continue
                pk = frozenset((ida, idb))
                if pk in seen:
                    continue
                sc = score_pair(a, b)
                if sc >= threshold:
                    seen.add(pk)
                    pairs.append((sc, a, b))
    pairs.sort(key=lambda p: p[0], reverse=True)
    return pairs[:limit]
