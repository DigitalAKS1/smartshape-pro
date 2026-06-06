import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { schools as schoolsApi, contacts as contactsApi } from '../lib/api';
import { toast } from 'sonner';

export default function useSchoolProfile(school_id) {
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedContact, setExpandedContact] = useState(null);
  const [stageFilter, setStageFilter] = useState('all');
  const [contactOpen, setContactOpen] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', phone: '', email: '', designation: '', notes: '' });
  const [editingContact, setEditingContact] = useState(null);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { loadProfile(); }, [school_id]); // eslint-disable-line
  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => setMounted(true), 40);
      return () => clearTimeout(t);
    }
  }, [loading]);

  async function loadProfile() {
    try {
      setLoading(true);
      const res = await schoolsApi.getProfile(school_id);
      setProfile(res.data);
    } catch {
      toast.error('Failed to load school profile');
      navigate('/leads');
    } finally {
      setLoading(false);
    }
  }

  async function saveContact() {
    if (!contactForm.name.trim() || !contactForm.phone.trim()) {
      toast.error('Name and phone required'); return;
    }
    setSaving(true);
    try {
      if (editingContact) {
        await contactsApi.update(editingContact.contact_id, contactForm);
        toast.success('Contact updated');
      } else {
        await contactsApi.create({
          ...contactForm,
          school_id: school_id,
          company: profile?.school?.school_name || '',
        });
        toast.success('Contact added');
      }
      setContactOpen(false);
      setEditingContact(null);
      loadProfile();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function openEditContact(c) {
    setEditingContact(c);
    setContactForm({
      name: c.name || '', phone: c.phone || '', email: c.email || '',
      company: c.company || profile?.school?.school_name || '',
      school_id: c.school_id || school_id || '',
      contact_role_id: c.contact_role_id || '',
      designation: c.designation || '',
      source: c.source || '', source_id: c.source_id || '',
      assigned_to: c.assigned_to || '',
      notes: c.notes || '', birthday: c.birthday || '',
      tag_ids: c.tag_ids || [],
    });
    setContactOpen(true);
  }

  function openAddContact() {
    setEditingContact(null);
    setContactForm({
      name: '', phone: '', email: '',
      company: profile?.school?.school_name || '', school_id: school_id || '',
      contact_role_id: '', designation: '', source: '', source_id: '',
      assigned_to: '', notes: '', birthday: '', tag_ids: [],
    });
    setContactOpen(true);
  }

  const filteredLeads = profile
    ? (stageFilter === 'all' ? profile.leads : profile.leads.filter(l => l.stage === stageFilter))
    : [];

  const feedItems = profile
    ? [
        ...profile.call_notes.map(n => ({
          date: n.created_at, dot: 'bg-blue-400',
          label: `Call note · ${n.created_by_name || n.created_by || 'Team'}`,
          detail: n.content || n.outcome || '',
        })),
        ...profile.visits.map(v => ({
          date: v.visit_date, dot: 'bg-violet-400',
          label: `Visit · ${v.executive_name || 'Sales Rep'}`,
          detail: v.purpose || v.notes || '',
        })),
        ...profile.meetings.map(m => ({
          date: m.followup_date, dot: 'bg-indigo-400',
          label: `Meeting · ${m.assigned_to || 'Team'}`,
          detail: m.notes || '',
        })),
        ...profile.quotations.map(q => ({
          date: q.created_at, dot: 'bg-emerald-400',
          label: `Quotation ${q.quotation_number || ''} · ${q.status}`,
          detail: q.grand_total != null
            ? (q.grand_total >= 100000
              ? `₹${(q.grand_total / 100000).toFixed(1)}L`
              : q.grand_total >= 1000
              ? `₹${(q.grand_total / 1000).toFixed(0)}K`
              : `₹${q.grand_total}`)
            : '₹0',
        })),
        ...profile.dispatches.map(d => ({
          date: d.sent_date || d.created_at, dot: 'bg-amber-400',
          label: `${d.material_type} dispatched`,
          detail: d.courier_name ? `Via ${d.courier_name}${d.tracking_number ? ' · ' + d.tracking_number : ''}` : '',
        })),
      ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 50)
    : [];

  return {
    profile, loading, mounted, reload: loadProfile,
    activeTab, setActiveTab,
    expandedContact, setExpandedContact,
    stageFilter, setStageFilter,
    contactOpen, setContactOpen,
    contactForm, setContactForm,
    editingContact, setEditingContact,
    saving, saveContact, openEditContact, openAddContact,
    filteredLeads, feedItems,
  };
}
