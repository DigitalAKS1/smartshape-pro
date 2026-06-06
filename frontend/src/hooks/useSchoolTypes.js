import { useState, useEffect } from 'react';
import { schoolTypes as schoolTypesApi } from '../lib/api';
import { SCHOOL_TYPES } from '../lib/crmConstants';

/**
 * Returns the list of school-type NAMES from the master, falling back to the
 * built-in SCHOOL_TYPES constant until the master loads (or if the call fails).
 * Keeps every school form's "Type" dropdown master-driven without prop plumbing.
 */
export default function useSchoolTypes() {
  const [types, setTypes] = useState(SCHOOL_TYPES);
  useEffect(() => {
    let active = true;
    schoolTypesApi.getAll()
      .then(r => {
        if (!active) return;
        const names = (Array.isArray(r.data) ? r.data : [])
          .filter(t => t.is_active !== false)
          .map(t => t.name)
          .filter(Boolean);
        if (names.length) setTypes(names);
      })
      .catch(() => { /* keep fallback */ });
    return () => { active = false; };
  }, []);
  return types;
}
