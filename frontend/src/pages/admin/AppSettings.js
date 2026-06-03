import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Building2, Mail, MessageSquare, Clock, MapPin, Shield, Sparkles } from 'lucide-react';
import useAppSettings from '../../hooks/useAppSettings';
import CompanySettingsSection from '../../components/settings/CompanySettingsSection';
import SecuritySection from '../../components/settings/SecuritySection';
import ModuleToggles from '../../components/settings/ModuleToggles';
import DeviceManagement from '../../components/settings/DeviceManagement';
import AISection from '../../components/settings/AISection';

const TABS = [
  { id: 'company',   label: 'Company',   icon: Building2 },
  { id: 'email',     label: 'Gmail',     icon: Mail },
  { id: 'whatsapp',  label: 'WhatsApp',  icon: MessageSquare },
  { id: 'scheduled', label: 'Sched WA',  icon: Clock },
  { id: 'field',     label: 'Field',     icon: MapPin },
  { id: 'devices',   label: 'Devices',   icon: Shield },
  { id: 'ai',        label: 'AI',        icon: Sparkles },
];

export default function AppSettings() {
  const s = useAppSettings();

  const card    = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  if (s.loading) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div>
          <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="settings-title">Settings</h1>
          <p className={`${textSec} mt-1 text-sm`}>Configure company profile, integrations</p>
        </div>

        {/* Tabs */}
        <div className={`flex gap-1 ${card} border rounded-md p-1`}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => s.setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded text-sm font-medium transition-all ${s.activeTab === tab.id ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
                data-testid={`settings-tab-${tab.id}`}>
                <Icon className="h-4 w-4" /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {s.activeTab === 'company' && (
          <CompanySettingsSection
            company={s.company}
            setCompany={s.setCompany}
            saving={s.saving}
            logoUploading={s.logoUploading}
            saveCompany={s.saveCompany}
            handleLogoUpload={s.handleLogoUpload}
            logoRef={s.logoRef}
          />
        )}

        {(s.activeTab === 'email' || s.activeTab === 'whatsapp' || s.activeTab === 'scheduled') && (
          <SecuritySection
            activeTab={s.activeTab}
            // Email
            emailSettings={s.emailSettings} setEmailSettings={s.setEmailSettings}
            showAppPwd={s.showAppPwd} setShowAppPwd={s.setShowAppPwd}
            testEmail={s.testEmail} setTestEmail={s.setTestEmail}
            testEmailSending={s.testEmailSending} saving={s.saving}
            saveEmail={s.saveEmail} handleTestEmail={s.handleTestEmail}
            // WhatsApp
            wa={s.wa} setWa={s.setWa}
            showWaPwd={s.showWaPwd} setShowWaPwd={s.setShowWaPwd}
            testPhone={s.testPhone} setTestPhone={s.setTestPhone}
            testMessage={s.testMessage} setTestMessage={s.setTestMessage}
            testWaSending={s.testWaSending}
            saveWa={s.saveWa} handleTestWa={s.handleTestWa}
            // WA Templates
            waTemplates={s.waTemplates}
            tplForm={s.tplForm} setTplForm={s.setTplForm}
            tplEditing={s.tplEditing} setTplEditing={s.setTplEditing}
            startNewTpl={s.startNewTpl} editTpl={s.editTpl}
            saveTpl={s.saveTpl} deleteTpl={s.deleteTpl}
            // Scheduled
            scheduledMsgs={s.scheduledMsgs}
            schedFilter={s.schedFilter} setSchedFilter={s.setSchedFilter}
            schedFormOpen={s.schedFormOpen} setSchedFormOpen={s.setSchedFormOpen}
            schedForm={s.schedForm} setSchedForm={s.setSchedForm}
            saveSchedMsg={s.saveSchedMsg} cancelSchedMsg={s.cancelSchedMsg}
          />
        )}

        {s.activeTab === 'field' && (
          <ModuleToggles
            officeLocation={s.officeLocation}
            setOfficeLocation={s.setOfficeLocation}
            officeLocating={s.officeLocating}
            officeSaving={s.officeSaving}
            captureOfficeLocation={s.captureOfficeLocation}
            saveOfficeLocation={s.saveOfficeLocation}
          />
        )}

        {s.activeTab === 'devices' && (
          <DeviceManagement
            devices={s.devices}
            deviceCounts={s.deviceCounts}
            deviceFilter={s.deviceFilter}
            setDeviceFilter={s.setDeviceFilter}
            devicePolicy={s.devicePolicy}
            setDevicePolicy={s.setDevicePolicy}
            devicePolicySaving={s.devicePolicySaving}
            deviceLoading={s.deviceLoading}
            deviceActioning={s.deviceActioning}
            loadDevices={s.loadDevices}
            approveDevice={s.approveDevice}
            revokeDevice={s.revokeDevice}
            removeDevice={s.removeDevice}
            saveDevicePolicy={s.saveDevicePolicy}
          />
        )}

        {s.activeTab === 'ai' && (
          <AISection
            aiKey={s.aiKey} setAiKey={s.setAiKey}
            aiKeySet={s.aiKeySet} aiKeyMasked={s.aiKeyMasked}
            aiSaving={s.aiSaving}
            showAiKey={s.showAiKey} setShowAiKey={s.setShowAiKey}
            saveAiKey={s.saveAiKey}
            dialler={s.dialler} setDialler={s.setDialler}
            diallerSaving={s.diallerSaving}
            showVapiKey={s.showVapiKey} setShowVapiKey={s.setShowVapiKey}
            saveDialler={s.saveDialler}
          />
        )}
      </div>
    </AdminLayout>
  );
}
