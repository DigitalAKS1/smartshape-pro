import { useState, useEffect, useCallback } from 'react';
import { mailMaterials } from '../lib/api';

// D3: one shared list, fetched once per mounting surface. A failure falls back
// to the seeded union rather than leaving the picker empty — authoring a post
// step must never be blocked by a slow or failed catalogue read, and an empty
// dropdown would silently rewrite a step's material on the next save.
//
// `piece_type` is the value that is stored (a step's `material_type`, a run's
// and a touch's `piece_type`); `name` is only the label a human reads.
const FALLBACK = [
  { material_id: '_brochure', name: 'Brochure', piece_type: 'brochure', active: true },
  { material_id: '_sample', name: 'Sample', piece_type: 'sample', active: true },
  { material_id: '_catalogue', name: 'Catalogue', piece_type: 'catalogue', active: true },
  { material_id: '_kit', name: 'Kit', piece_type: 'kit', active: true },
  { material_id: '_newsletter', name: 'Newsletter', piece_type: 'newsletter', active: true },
  { material_id: '_gift', name: 'Gift', piece_type: 'gift', active: true },
  { material_id: '_other', name: 'Other', piece_type: 'other', active: true },
];

export default function useMailMaterials() {
  const [materials, setMaterials] = useState(FALLBACK);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await mailMaterials.list();
      const rows = Array.isArray(r?.data) ? r.data.filter(m => m.active !== false) : [];
      setMaterials(rows.length ? rows : FALLBACK);
    } catch {
      setMaterials(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { materials, loading, reload };
}
