import { useState, useEffect, useCallback, useMemo } from 'react';
import { lookups as lookupsApi } from '../lib/api';
import { FALLBACKS, labelFor as labelForItems } from '../lib/lookupUtils';

/**
 * One lookup master list (school_category, product_category, package_type, …).
 * `items` starts as the built-in fallback so pickers never render empty, then
 * swaps to the live master. `activeItems` is what pickers offer; `labelFor`
 * still labels records that hold an inactive value.
 */
export default function useLookup(listKey) {
  const [items, setItems] = useState(FALLBACKS[listKey] || []);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    let alive = true;
    lookupsApi.getAll(listKey)
      .then(r => { if (alive && Array.isArray(r.data)) { setItems(r.data); setLoaded(true); } })
      .catch(() => { /* keep fallback */ });
    return () => { alive = false; };
  }, [listKey]);

  useEffect(() => reload(), [reload]);

  const activeItems = useMemo(() => items.filter(i => i.is_active !== false), [items]);
  const labelFor = useCallback((stored) => labelForItems(items, stored), [items]);

  return { items, activeItems, labelFor, reload, loaded, setItems };
}
