import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  ArrowRight, X, Search, UserPlus, CheckCircle2, User, Building2, Plus,
} from 'lucide-react';

const card     = 'bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const tPri     = 'text-[var(--text-primary)]';
const tSec     = 'text-[var(--text-secondary)]';
const tMut     = 'text-[var(--text-muted)]';

export default function QuotationStep1Contact({
  // contact search
  contactQuery, setContactQuery,
  filteredContacts,
  selectedContact, setSelectedContact,
  selectContact,
  // new contact form
  showNewContact, setShowNewContact,
  newContactData, setNewContactData,
  savingContact,
  handleCreateContact,
  // school autocomplete inside new contact
  schoolQuery, setSchoolQuery,
  showSchoolDrop, setShowSchoolDrop,
  filteredSchools, pickSchool,
  newSchoolData, setNewSchoolData,
  setAddSchoolOpen,
  schoolDropRef,
  // navigation
  setStep,
}) {
  return (
    <div className="px-4 sm:px-0 space-y-4">
      <div>
        <h2 className={`text-lg font-semibold ${tPri} mb-0.5`}>Select Contact</h2>
        <p className={`text-sm ${tSec}`}>Search for an existing contact or add a new one</p>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${tMut}`} />
        <Input
          placeholder="Search by name, phone, or school..."
          value={contactQuery}
          onChange={e => { setContactQuery(e.target.value); setShowNewContact(false); }}
          className={`pl-10 h-12 text-base ${inputCls}`}
          autoFocus
        />
        {contactQuery && (
          <button
            onClick={() => setContactQuery('')}
            className={`absolute right-3 top-1/2 -translate-y-1/2 ${tMut}`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Selected contact banner */}
      {selectedContact && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[#10b981]/10 border border-[#10b981]/30">
          <CheckCircle2 className="h-5 w-5 text-[#10b981] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className={`font-semibold text-sm ${tPri} truncate`}>{selectedContact.name}</p>
            <p className={`text-xs ${tSec} truncate`}>
              {[selectedContact.designation, selectedContact.company, selectedContact.phone].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={() => setSelectedContact(null)} className={`${tMut} hover:text-red-400 flex-shrink-0`}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Contact list / empty state */}
      {!showNewContact && (
        <>
          {filteredContacts.length > 0 ? (
            <div className={`${card} border rounded-xl overflow-hidden`}>
              {/* Table header */}
              <div className="grid grid-cols-[1fr_1fr_auto] gap-0 border-b border-[var(--border-color)] px-3 py-2 bg-[var(--bg-primary)]">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${tMut}`}>Name</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${tMut}`}>School / Company</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${tMut} text-right`}>Phone</span>
              </div>
              {/* Table rows */}
              <div className="max-h-[40vh] overflow-y-auto divide-y divide-[var(--border-color)]">
                {filteredContacts.map(contact => {
                  const isSelected = selectedContact?.contact_id === contact.contact_id;
                  return (
                    <button
                      key={contact.contact_id}
                      onClick={() => selectContact(contact)}
                      className={`w-full text-left grid grid-cols-[1fr_1fr_auto] gap-0 px-3 py-2.5 transition-colors active:opacity-70 ${
                        isSelected ? 'bg-[#10b981]/8 border-l-2 border-l-[#10b981]' : 'hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isSelected
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-[#10b981] flex-shrink-0" />
                          : <User className={`h-3.5 w-3.5 ${tMut} flex-shrink-0`} />
                        }
                        <span className={`text-sm font-medium ${tPri} truncate`}>{contact.name}</span>
                      </div>
                      <span className={`text-sm ${tSec} truncate self-center`}>
                        {contact.company || <span className={tMut}>—</span>}
                      </span>
                      <span className={`text-xs font-mono ${tSec} self-center text-right pl-3`}>
                        {contact.phone || '—'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : contactQuery ? (
            /* No results */
            <div className={`${card} border rounded-xl p-5 text-center space-y-3`}>
              <div className="w-12 h-12 rounded-full bg-[var(--bg-primary)] flex items-center justify-center mx-auto">
                <Search className={`h-5 w-5 ${tMut}`} />
              </div>
              <div>
                <p className={`text-sm font-medium ${tPri}`}>No contact found for "{contactQuery}"</p>
                <p className={`text-xs ${tMut} mt-0.5`}>This school may not be in your contacts yet</p>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  onClick={() => setStep(2)}
                  className="h-11 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold"
                >
                  Skip &amp; Enter Manually <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <p className={`text-xs ${tMut}`}>You can enter customer details manually in the pricing step</p>
                <button
                  onClick={() => setShowNewContact(true)}
                  className={`text-xs ${tSec} underline underline-offset-2 hover:text-[#e94560] transition-colors`}
                >
                  + Add new contact instead
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* New Contact form */}
      {showNewContact && (
        <div className={`${card} border rounded-xl p-4 space-y-3`}>
          <div className="flex items-center justify-between">
            <h3 className={`font-semibold text-sm ${tPri}`}>New Contact</h3>
            <button
              onClick={() => { setShowNewContact(false); setSchoolQuery(''); setShowSchoolDrop(false); }}
              className={tMut}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className={`text-xs ${tSec} mb-1`}>Name *</Label>
              <Input
                value={newContactData.name}
                onChange={e => setNewContactData(p => ({ ...p, name: e.target.value }))}
                placeholder="Full name"
                className={`h-11 ${inputCls}`}
              />
            </div>
            <div>
              <Label className={`text-xs ${tSec} mb-1`}>Phone *</Label>
              <Input
                value={newContactData.phone}
                onChange={e => setNewContactData(p => ({ ...p, phone: e.target.value }))}
                placeholder="Mobile number"
                className={`h-11 ${inputCls}`}
                type="tel"
              />
            </div>
            <div>
              <Label className={`text-xs ${tSec} mb-1`}>Email</Label>
              <Input
                value={newContactData.email}
                onChange={e => setNewContactData(p => ({ ...p, email: e.target.value }))}
                placeholder="Email address"
                className={`h-11 ${inputCls}`}
                type="email"
              />
            </div>

            {/* School / Company autocomplete */}
            <div className="relative" ref={schoolDropRef}>
              <Label className={`text-xs ${tSec} mb-1`}>School / Company</Label>
              <div className="relative">
                <Building2 className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${tMut} pointer-events-none`} />
                <Input
                  value={schoolQuery}
                  onChange={e => {
                    const v = e.target.value;
                    setSchoolQuery(v);
                    setNewContactData(p => ({ ...p, company: v }));
                    setShowSchoolDrop(true);
                  }}
                  onFocus={() => schoolQuery && setShowSchoolDrop(true)}
                  placeholder="Type school name…"
                  className={`h-11 pl-9 pr-9 ${inputCls}`}
                  autoComplete="off"
                />
                {schoolQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSchoolQuery('');
                      setNewContactData(p => ({ ...p, company: '' }));
                      setShowSchoolDrop(false);
                    }}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 ${tMut}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {/* Dropdown */}
              {showSchoolDrop && schoolQuery.trim() && (
                <div className={`absolute z-50 left-0 right-0 mt-1 rounded-xl border ${inputCls} shadow-lg overflow-hidden`}>
                  {filteredSchools.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto divide-y divide-[var(--border-color)]">
                      {filteredSchools.map(s => (
                        <button
                          key={s.school_id}
                          type="button"
                          onMouseDown={() => pickSchool(s)}
                          className="w-full text-left px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2"
                        >
                          <Building2 className={`h-3.5 w-3.5 flex-shrink-0 ${tMut}`} />
                          <div className="min-w-0">
                            <p className={`text-sm font-medium ${tPri} truncate`}>{s.school_name}</p>
                            <p className={`text-xs ${tMut} truncate`}>{[s.school_type, s.city].filter(Boolean).join(' · ')}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={`px-3 py-2 text-xs ${tMut}`}>No schools found</div>
                  )}
                  {/* Add new school option */}
                  <button
                    type="button"
                    onMouseDown={() => {
                      setNewSchoolData(p => ({ ...p, school_name: schoolQuery.trim() }));
                      setShowSchoolDrop(false);
                      setAddSchoolOpen(true);
                    }}
                    className="w-full text-left px-3 py-2.5 border-t border-[var(--border-color)] flex items-center gap-2 text-[#e94560] hover:bg-[#e94560]/5 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="text-sm font-medium">Add "{schoolQuery.trim()}" as new school</span>
                  </button>
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <Label className={`text-xs ${tSec} mb-1`}>Designation</Label>
              <Input
                value={newContactData.designation}
                onChange={e => setNewContactData(p => ({ ...p, designation: e.target.value }))}
                placeholder="e.g. Principal, Director"
                className={`h-11 ${inputCls}`}
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleCreateContact}
              disabled={savingContact}
              className="flex-1 h-11 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold"
            >
              {savingContact ? 'Saving...' : 'Create & Use Contact'}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setShowNewContact(false); setSchoolQuery(''); setShowSchoolDrop(false); }}
              className={`border-[var(--border-color)] ${tSec} h-11`}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Add new contact button */}
      {!showNewContact && (filteredContacts.length > 0 || !contactQuery) && (
        <button
          onClick={() => setShowNewContact(true)}
          className={`w-full p-3.5 rounded-xl border-2 border-dashed border-[var(--border-color)] hover:border-[#e94560]/50 transition-colors flex items-center justify-center gap-2 ${tSec}`}
        >
          <UserPlus className="h-4 w-4" />
          <span className="text-sm font-medium">Add New Contact</span>
        </button>
      )}

      {/* Next button */}
      <div className="pt-2">
        <Button
          onClick={() => setStep(2)}
          className="w-full h-12 bg-[#e94560] hover:bg-[#f05c75] text-white font-semibold text-base"
          data-testid="step1-next-button"
        >
          {selectedContact ? `Continue with ${selectedContact.name}` : 'Skip & Enter Manually'}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
        {!selectedContact && (
          <p className={`text-center text-xs ${tMut} mt-2`}>
            You can enter customer details manually in the pricing step
          </p>
        )}
      </div>
    </div>
  );
}
