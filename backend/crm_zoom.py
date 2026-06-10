"""Zoom -> CRM mapping helpers: fuzzy-match a parsed school name to an existing CRM
school, and snap a free-text designation to the contact-role master. Pure functions
(stdlib difflib) so they are unit-testable without a DB."""
import re
from difflib import SequenceMatcher
from typing import List, Dict, Any, Optional

_WS = re.compile(r"[^a-z0-9 ]+")


def _norm(s: str) -> str:
    """Lowercase, strip punctuation, collapse + sort words so 'Delhi Public School'
    and 'Public School Delhi' compare closely."""
    t = _WS.sub(" ", (s or "").lower())
    words = [w for w in t.split() if w]
    return " ".join(sorted(words))


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def match_school(name: str, schools: List[Dict[str, Any]], threshold: float = 0.84) -> Optional[Dict[str, Any]]:
    """schools: [{school_id, school_name}]. Returns {school_id, school_name, score} or None."""
    if not (name or "").strip():
        return None
    target = _norm(name)
    best, best_score = None, 0.0
    for s in schools:
        nm = s.get("school_name", "")
        score = _ratio(target, _norm(nm))
        # bonus for containment (acronym/short forms, e.g. 'DPS' in 'DPS Delhi')
        if target and (target in _norm(nm) or _norm(nm) in target):
            score = max(score, 0.9)
        if score > best_score:
            best, best_score = s, score
    if best and best_score >= threshold:
        return {"school_id": best.get("school_id"), "school_name": best.get("school_name"), "score": round(best_score, 3)}
    return None


def match_role(designation: str, roles: List[Dict[str, Any]], threshold: float = 0.72) -> Optional[Dict[str, Any]]:
    """roles: [{contact_role_id/_id, name}]. Returns {role_id, name, score} or None."""
    d = (designation or "").strip().lower()
    if not d:
        return None
    best, best_score = None, 0.0
    for r in roles:
        nm = (r.get("name") or "").strip()
        if not nm:
            continue
        score = _ratio(d, nm.lower())
        if nm.lower() in d or d in nm.lower():
            score = max(score, 0.9)
        if score > best_score:
            best, best_score = r, score
    if best and best_score >= threshold:
        rid = best.get("contact_role_id") or best.get("role_id") or best.get("id")
        return {"role_id": rid, "name": best.get("name"), "score": round(best_score, 3)}
    return None


def suggest_rows(rows: List[Dict[str, Any]], schools: List[Dict[str, Any]],
                 roles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Attach school_match + role_match suggestions to each row (non-destructive)."""
    out = []
    for r in rows:
        out.append({
            **r,
            "school_match": match_school(r.get("school", ""), schools),
            "role_match": match_role(r.get("designation", ""), roles),
        })
    return out
