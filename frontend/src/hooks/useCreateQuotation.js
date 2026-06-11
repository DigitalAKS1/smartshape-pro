import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { packages, salesPersons, quotations, companySettings, contacts as contactsApi, schools as schoolsApi, schoolPortalSettings } from '../lib/api';

export default function useCreateQuotation() {
  const navigate = useNavigate();

  // ── Wizard step ──────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);

  // ── Remote data ──────────────────────────────────────────────────────────
  const [packagesList, setPackagesList]     = useState([]);
  const [salesPersonsList, setSalesPersonsList] = useState([]);
  const [contactsList, setContactsList]     = useState([]);
  const [schoolsList, setSchoolsList]       = useState([]);
  const [company, setCompany]               = useState({});

  // ── Step 1 — Contact ─────────────────────────────────────────────────────
  const [contactQuery, setContactQuery]     = useState('');
  const [selectedContact, setSelectedContact] = useState(null);
  const [showNewContact, setShowNewContact] = useState(false);
  const [savingContact, setSavingContact]   = useState(false);
  const [newContactData, setNewContactData] = useState({
    name: '', phone: '', email: '', company: '', school_id: null, designation: '',
  });

  // School autocomplete inside New Contact form
  const [schoolQuery, setSchoolQuery]         = useState('');
  const [showSchoolDrop, setShowSchoolDrop]   = useState(false);
  const [addSchoolOpen, setAddSchoolOpen]     = useState(false);
  const [savingSchool, setSavingSchool]       = useState(false);
  const [newSchoolData, setNewSchoolData]     = useState({
    school_name: '', school_type: 'CBSE', city: '', phone: '',
  });
  const schoolDropRef = useRef(null);

  // ── Step 3 — Add product ─────────────────────────────────────────────────
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    description: '', product_type: 'custom', qty: 1, unit_price: 0, gst_pct: 18,
  });

  // ── Main form ────────────────────────────────────────────────────────────
  const [formData, setFormData] = useState({
    package_id: '', principal_name: '', school_name: '', address: '',
    city: '', state: '', pincode: '',
    customer_email: '', customer_phone: '', customer_gst: '',
    sales_person_id: '', discount1_pct: 0, discount2_pct: 0,
    freight_amount: 0, lines: [],
    bank_details_override: '', terms_override: '',
    font_size_mode: 'medium',
    currency_symbol: '₹',
    valid_until: '',
    portal_login_methods: { email_link: true, magic_link: false, google: false },
  });
  const [selectedPackage, setSelectedPackage] = useState(null);

  // ── Initial data fetch ───────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [pkgsRes, spRes, compRes, ctRes, schRes] = await Promise.all([
          packages.getAll(), salesPersons.getAll(), companySettings.get(),
          contactsApi.getAll(), schoolsApi.getAll(),
        ]);
        setPackagesList(pkgsRes.data || []);
        setSalesPersonsList(spRes.data || []);
        setContactsList(ctRes.data || []);
        setSchoolsList(schRes.data || []);
        const comp = compRes.data || {};
        setCompany(comp);
        setFormData(prev => ({
          ...prev,
          bank_details_override: prev.bank_details_override || comp.bank_details || '',
          terms_override: prev.terms_override || comp.terms_conditions || '',
        }));
        // Seed per-quote portal login methods from the global defaults.
        try {
          const sp = await schoolPortalSettings.get();
          const g = sp.data || {};
          setFormData(prev => ({
            ...prev,
            portal_login_methods: {
              email_link: !!g.email_link_enabled,
              magic_link: !!g.magic_link_enabled,
              google: !!g.google_enabled,
            },
          }));
        } catch { /* keep defaults */ }
      } catch {
        toast.error('Failed to load data');
      }
    };
    fetchData();
  }, []);

  // Close school dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (schoolDropRef.current && !schoolDropRef.current.contains(e.target)) {
        setShowSchoolDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Contact helpers ──────────────────────────────────────────────────────
  const filteredContacts = contactQuery.trim()
    ? contactsList.filter(c =>
        c.name?.toLowerCase().includes(contactQuery.toLowerCase()) ||
        c.phone?.includes(contactQuery) ||
        c.company?.toLowerCase().includes(contactQuery.toLowerCase()) ||
        c.email?.toLowerCase().includes(contactQuery.toLowerCase())
      )
    : contactsList.slice(0, 12);

  const selectContact = (contact) => {
    setSelectedContact(contact);
    setFormData(prev => ({
      ...prev,
      principal_name: contact.name || prev.principal_name,
      school_name:    contact.company || prev.school_name,
      customer_phone: contact.phone || prev.customer_phone,
      customer_email: contact.email || prev.customer_email,
    }));
    setShowNewContact(false);
  };

  const handleCreateContact = async () => {
    if (!newContactData.name || !newContactData.phone) {
      toast.error('Name and phone are required');
      return;
    }
    setSavingContact(true);
    try {
      const res = await contactsApi.create(newContactData);
      const created = res.data;
      setContactsList(prev => [created, ...prev]);
      selectContact(created);
      setNewContactData({ name: '', phone: '', email: '', company: '', school_id: null, designation: '' });
      setShowNewContact(false);
      toast.success('Contact created & selected');
    } catch {
      toast.error('Failed to create contact');
    } finally {
      setSavingContact(false);
    }
  };

  // ── School autocomplete helpers ──────────────────────────────────────────
  const filteredSchools = schoolQuery.trim()
    ? schoolsList.filter(s =>
        s.school_name?.toLowerCase().includes(schoolQuery.toLowerCase()) ||
        s.city?.toLowerCase().includes(schoolQuery.toLowerCase())
      ).slice(0, 8)
    : [];

  const pickSchool = (school) => {
    const name = school.school_name;
    setSchoolQuery(name);
    setNewContactData(prev => ({ ...prev, company: name, school_id: school.school_id || null }));
    setShowSchoolDrop(false);
  };

  const handleCreateSchool = async () => {
    if (!newSchoolData.school_name.trim() || !newSchoolData.city.trim()) {
      toast.error('School name and city are required');
      return;
    }
    setSavingSchool(true);
    try {
      const res = await schoolsApi.create(newSchoolData);
      const created = res.data;
      setSchoolsList(prev => [created, ...prev]);
      pickSchool(created);
      setAddSchoolOpen(false);
      setNewSchoolData({ school_name: '', school_type: 'CBSE', city: '', phone: '' });
      toast.success('School added & selected');
    } catch {
      toast.error('Failed to create school');
    } finally {
      setSavingSchool(false);
    }
  };

  // ── Package helpers ──────────────────────────────────────────────────────
  const handlePackageSelect = (pkg) => {
    setSelectedPackage(pkg);
    const items = pkg.items || [];
    const lines = items.map((item, idx) => ({
      description: `${item.name} (${item.qty} units)`,
      product_type: item.type,
      qty: item.qty,
      unit_price: item.unit_price,
      gst_pct: item.gst_pct || 18,
      line_subtotal: item.qty * item.unit_price,
      line_gst: item.qty * item.unit_price * (item.gst_pct || 18) / 100,
      line_total: item.qty * item.unit_price * (1 + (item.gst_pct || 18) / 100),
      sort_order: idx + 1,
    }));
    setFormData(prev => ({ ...prev, package_id: pkg.package_id, lines }));
  };

  // ── Line helpers ─────────────────────────────────────────────────────────
  const recalcLine = (line) => {
    const sub = line.qty * line.unit_price;
    const gst = sub * (line.gst_pct / 100);
    return { ...line, line_subtotal: sub, line_gst: gst, line_total: sub + gst };
  };

  const updateLine = (idx, field, value) => {
    const lines = [...formData.lines];
    lines[idx] = {
      ...lines[idx],
      [field]: field === 'description' || field === 'product_type'
        ? value
        : parseFloat(value) || 0,
    };
    lines[idx] = recalcLine(lines[idx]);
    setFormData(prev => ({ ...prev, lines }));
  };

  const handleAddCustomProduct = () => {
    if (!newProduct.description) { toast.error('Product name required'); return; }
    const line = recalcLine({ ...newProduct, line_subtotal: 0, line_gst: 0, line_total: 0, sort_order: formData.lines.length + 1 });
    setFormData(prev => ({ ...prev, lines: [...prev.lines, line] }));
    setNewProduct({ description: '', product_type: 'custom', qty: 1, unit_price: 0, gst_pct: 18 });
    setShowAddProduct(false);
    toast.success('Item added');
  };

  const handleRemoveLine = (idx) => {
    setFormData(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }));
  };

  // ── Totals ───────────────────────────────────────────────────────────────
  const calcTotals = () => {
    const lines        = formData.lines || [];
    const items_total  = lines.reduce((s, l) => s + (l.line_subtotal || 0), 0);
    const disc1_amount = items_total * ((formData.discount1_pct || 0) / 100);
    const after_d1     = items_total - disc1_amount;
    const disc2_amount = after_d1 * ((formData.discount2_pct || 0) / 100);
    const after_disc   = after_d1 - disc2_amount;
    const freight_base = Number(formData.freight_amount) || 0;
    const sub_total    = after_disc + freight_base;

    const discount_factor = items_total > 0 ? after_disc / items_total : 1;
    const raw_items_gst   = lines.reduce((s, l) => s + (l.line_subtotal || 0) * ((l.gst_pct || 18) / 100), 0);
    const items_gst       = raw_items_gst * discount_factor;
    const freight_gst     = freight_base * 0.18;
    const total_gst       = items_gst + freight_gst;
    const grand_total     = sub_total + total_gst;

    // GST grouped by rate slab (single line when all items are 18%)
    const slabs = {};
    lines.forEach((l) => {
      const rate = l.gst_pct || 18;
      if (!slabs[rate]) slabs[rate] = { rate, taxable: 0, amount: 0 };
      slabs[rate].taxable += (l.line_subtotal || 0) * discount_factor;
      slabs[rate].amount  += (l.line_subtotal || 0) * (rate / 100) * discount_factor;
    });
    if (freight_base > 0) {
      if (!slabs[18]) slabs[18] = { rate: 18, taxable: 0, amount: 0 };
      slabs[18].taxable += freight_base;
      slabs[18].amount  += freight_gst;
    }
    const gst_breakup = Object.keys(slabs)
      .map((r) => slabs[r])
      .filter((s) => s.amount > 0)
      .sort((a, b) => b.rate - a.rate);

    return { items_total, disc1_amount, disc2_amount, after_disc, freight_base, sub_total, items_gst, freight_gst, total_gst, gst_breakup, grand_total };
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!formData.principal_name || !formData.school_name) {
      toast.error('Principal name and school name are required');
      return;
    }
    try {
      await quotations.create(formData);
      toast.success('Quotation created successfully!');
      navigate('/quotations');
    } catch {
      toast.error('Failed to create quotation');
    }
  };

  return {
    // Step
    step, setStep,
    // Remote data
    packagesList, salesPersonsList, company,
    // Step 1
    contactQuery, setContactQuery,
    selectedContact, setSelectedContact,
    showNewContact, setShowNewContact,
    savingContact,
    newContactData, setNewContactData,
    filteredContacts,
    selectContact, handleCreateContact,
    // School autocomplete
    schoolQuery, setSchoolQuery,
    showSchoolDrop, setShowSchoolDrop,
    addSchoolOpen, setAddSchoolOpen,
    savingSchool,
    newSchoolData, setNewSchoolData,
    schoolDropRef,
    filteredSchools, pickSchool, handleCreateSchool,
    // Step 2
    selectedPackage, handlePackageSelect,
    // Step 3
    formData, setFormData,
    showAddProduct, setShowAddProduct,
    newProduct, setNewProduct,
    updateLine, handleAddCustomProduct, handleRemoveLine,
    calcTotals, handleSubmit,
  };
}
