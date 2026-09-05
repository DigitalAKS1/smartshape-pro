import { useCallback, useEffect, useState } from 'react';
import {
  schools as schoolsApi,
  leads as leadsApi,
  tasks as tasksApi,
  salesPersons,
  contacts as contactsApi,
  groups as groupsApi,
  sources as sourcesApi,
  contactRoles as contactRolesApi,
  tags as tagsApi,
  dripSequences as dripSequencesApi,
  quotations as quotationsApi,
  designations as designationsApi,
  dealTypes as dealTypesApi,
} from '../lib/api';
import { useDataSync, useAutoRefresh } from '../lib/dataSync';
import { toast } from 'sonner';

/**
 * Everything the CRM page reads, and nothing about what it does with it.
 *
 * Thirteen lists in one round of parallel requests. The five the page cannot
 * render without are allowed to fail loudly; the eight that only populate
 * dropdowns fall back to empty, because a missing tag list should not blank the
 * whole screen.
 *
 * Split out of useLeadsCRM so that "where does this data come from" is one short
 * file rather than a section in the middle of nine hundred lines of form state.
 */
export default function useCrmData() {
  const [leadsList, setLeadsList] = useState([]);
  const [schoolsList, setSchoolsList] = useState([]);
  const [tasksList, setTasksList] = useState([]);
  const [contactsList, setContactsList] = useState([]);
  const [spList, setSpList] = useState([]);
  const [groupsList, setGroupsList] = useState([]);
  const [sourcesList, setSourcesList] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [dealTypesList, setDealTypesList] = useState([]);
  const [tagsList, setTagsList] = useState([]);
  const [dripSequencesList, setDripSequencesList] = useState([]);
  const [allQuotations, setAllQuotations] = useState([]);
  const [designationsList, setDesignationsList] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [lr, sr, tr, spr, cr, gr, srcR, rlR, tgR, dripR, qR, desR, dtR] = await Promise.all([
        leadsApi.getAll(), schoolsApi.getAll(), tasksApi.getAll(), salesPersons.getAll(), contactsApi.getAll(),
        groupsApi.getAll().catch(() => ({ data: [] })),
        sourcesApi.getAll().catch(() => ({ data: [] })),
        contactRolesApi.getAll().catch(() => ({ data: [] })),
        tagsApi.getAll().catch(() => ({ data: [] })),
        dripSequencesApi.getAll().catch(() => ({ data: [] })),
        quotationsApi.getAll().catch(() => ({ data: [] })),
        designationsApi.getAll().catch(() => ({ data: [] })),
        dealTypesApi.getAll().catch(() => ({ data: [] })),
      ]);
      const arr = (x) => Array.isArray(x) ? x : [];
      setLeadsList(arr(lr.data));
      setSchoolsList(arr(sr.data));
      setTasksList(arr(tr.data));
      setSpList(arr(spr.data));
      setContactsList(arr(cr.data));
      setGroupsList(arr(gr.data));
      setSourcesList(arr(srcR.data));
      setRolesList(arr(rlR.data));
      setTagsList(arr(tgR.data));
      setDripSequencesList(arr(dripR.data));
      setAllQuotations(arr(qR.data));
      setDesignationsList(arr(desR.data));
      setDealTypesList(arr(dtR.data));
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };

  const stableFetch = useCallback(() => { fetchData(); }, []); // eslint-disable-line
  useEffect(() => { stableFetch(); }, [stableFetch]);
  useDataSync('crm', stableFetch);
  useAutoRefresh(stableFetch, 90000);

  return {
    leadsList, setLeadsList,
    schoolsList, setSchoolsList,
    tasksList, setTasksList,
    contactsList, setContactsList,
    spList, groupsList, setGroupsList,
    sourcesList, setSourcesList,
    rolesList, setRolesList,
    dealTypesList, tagsList, setTagsList,
    dripSequencesList, allQuotations, designationsList,
    loading, setLoading,
    fetchData,
  };
}
