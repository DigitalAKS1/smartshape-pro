import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { SCHOOL_TYPES } from '../../lib/crmConstants';
import useCreateQuotation from '../../hooks/useCreateQuotation';
import QuotationStepIndicator from '../../components/quotations/QuotationStepIndicator';
import QuotationStep1Contact from '../../components/quotations/QuotationStep1Contact';
import QuotationStep2Package from '../../components/quotations/QuotationStep2Package';
import QuotationStep3Pricing from '../../components/quotations/QuotationStep3Pricing';

const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const tPri = 'text-[var(--text-primary)]';
const tSec = 'text-[var(--text-secondary)]';

export default function CreateQuotation() {
  const hook = useCreateQuotation();

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto pb-8">

        {/* Header */}
        <div className="px-4 sm:px-0 py-4 sm:py-0 sm:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            {hook.company.logo_url && (
              <img
                src={hook.company.logo_url}
                alt="Logo"
                className="h-8 sm:h-10 max-w-[160px] object-contain flex-shrink-0"
              />
            )}
            <div>
              <h1 className={`text-xl sm:text-2xl font-bold ${tPri} leading-tight`} data-testid="create-quotation-title">
                Create Quotation
              </h1>
              <p className={`text-sm ${tSec}`}>Follow the steps to create a new quotation</p>
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <QuotationStepIndicator step={hook.step} />

        {/* Step 1 */}
        {hook.step === 1 && (
          <QuotationStep1Contact
            contactQuery={hook.contactQuery}
            setContactQuery={hook.setContactQuery}
            filteredContacts={hook.filteredContacts}
            selectedContact={hook.selectedContact}
            setSelectedContact={hook.setSelectedContact}
            selectContact={hook.selectContact}
            showNewContact={hook.showNewContact}
            setShowNewContact={hook.setShowNewContact}
            newContactData={hook.newContactData}
            setNewContactData={hook.setNewContactData}
            savingContact={hook.savingContact}
            handleCreateContact={hook.handleCreateContact}
            schoolQuery={hook.schoolQuery}
            setSchoolQuery={hook.setSchoolQuery}
            showSchoolDrop={hook.showSchoolDrop}
            setShowSchoolDrop={hook.setShowSchoolDrop}
            filteredSchools={hook.filteredSchools}
            pickSchool={hook.pickSchool}
            newSchoolData={hook.newSchoolData}
            setNewSchoolData={hook.setNewSchoolData}
            setAddSchoolOpen={hook.setAddSchoolOpen}
            schoolDropRef={hook.schoolDropRef}
            setStep={hook.setStep}
          />
        )}

        {/* Step 2 */}
        {hook.step === 2 && (
          <QuotationStep2Package
            packagesList={hook.packagesList}
            selectedContact={hook.selectedContact}
            formData={hook.formData}
            handlePackageSelect={hook.handlePackageSelect}
            setStep={hook.setStep}
          />
        )}

        {/* Step 3 */}
        {hook.step === 3 && (
          <QuotationStep3Pricing
            formData={hook.formData}
            setFormData={hook.setFormData}
            salesPersonsList={hook.salesPersonsList}
            selectedPackage={hook.selectedPackage}
            company={hook.company}
            showAddProduct={hook.showAddProduct}
            setShowAddProduct={hook.setShowAddProduct}
            newProduct={hook.newProduct}
            setNewProduct={hook.setNewProduct}
            updateLine={hook.updateLine}
            handleAddCustomProduct={hook.handleAddCustomProduct}
            handleRemoveLine={hook.handleRemoveLine}
            calcTotals={hook.calcTotals}
            setStep={hook.setStep}
            handleSubmit={hook.handleSubmit}
            submitting={hook.submitting}
          />
        )}
      </div>

      {/* Quick Add School Dialog */}
      <Dialog open={hook.addSchoolOpen} onOpenChange={hook.setAddSchoolOpen}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className={tPri}>Add New School</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label className={`text-xs ${tSec} mb-1`}>School Name *</Label>
              <Input
                value={hook.newSchoolData.school_name}
                onChange={e => hook.setNewSchoolData(p => ({ ...p, school_name: e.target.value }))}
                placeholder="e.g. Delhi Public School"
                className={`h-11 ${inputCls}`}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`text-xs ${tSec} mb-1`}>Type</Label>
                <select
                  value={hook.newSchoolData.school_type}
                  onChange={e => hook.setNewSchoolData(p => ({ ...p, school_type: e.target.value }))}
                  className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}
                >
                  {SCHOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label className={`text-xs ${tSec} mb-1`}>City *</Label>
                <Input
                  value={hook.newSchoolData.city}
                  onChange={e => hook.setNewSchoolData(p => ({ ...p, city: e.target.value }))}
                  placeholder="e.g. Mumbai"
                  className={`h-11 ${inputCls}`}
                />
              </div>
            </div>
            <div>
              <Label className={`text-xs ${tSec} mb-1`}>Phone</Label>
              <Input
                value={hook.newSchoolData.phone}
                onChange={e => hook.setNewSchoolData(p => ({ ...p, phone: e.target.value }))}
                placeholder="School contact number"
                className={`h-11 ${inputCls}`}
                type="tel"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => hook.setAddSchoolOpen(false)}
              className={`border-[var(--border-color)] ${tSec}`}
            >
              Cancel
            </Button>
            <Button
              onClick={hook.handleCreateSchool}
              disabled={hook.savingSchool}
              className="bg-[#e94560] hover:bg-[#f05c75] text-white"
            >
              {hook.savingSchool ? 'Adding…' : 'Add School'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
