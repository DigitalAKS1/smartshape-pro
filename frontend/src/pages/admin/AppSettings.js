import React from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { Building2, Mail, MessageSquare, Clock, MapPin, Shield, Sparkles, Video, Cloud, FileSpreadsheet, Bell, Lock, GraduationCap, LayoutGrid } from 'lucide-react';
import useAppSettings from '../../hooks/useAppSettings';
import CompanySettingsSection from '../../components/settings/CompanySettingsSection';
import SecuritySection from '../../components/settings/SecuritySection';
import ModuleToggles from '../../components/settings/ModuleToggles';
import DeviceManagement from '../../components/settings/DeviceManagement';
import AISection from '../../components/settings/AISection';
import ZoomSection from '../../components/settings/ZoomSection';
import CloudinarySection from '../../components/settings/CloudinarySection';
import SheetsSection from '../../components/settings/SheetsSection';
import NotificationsSection from '../../components/settings/NotificationsSection';
import DailyDigestSection from '../../components/settings/DailyDigestSection';
import OrdersReportSection from '../../components/settings/OrdersReportSection';
import SchoolPortalSection from '../../components/settings/SchoolPortalSection';
import WhatsAppConnectionSection from '../../components/settings/WhatsAppConnectionSection';
import SecurityTab from '../../components/settings/SecurityTab';
import IntegrationsOverview from '../../components/settings/IntegrationsOverview';

// Grouped navigation. `statusKey` (when present) shows a live connection dot and
// matches the keys from GET /settings/integrations/status.
const GROUPS = [
  { label: 'Company', items: [
    { id: 'company', label: 'Company', icon: Building2 },
  ]},
  { label: 'Integrations', items: [
    { id: 'overview',      label: 'Overview',       icon: LayoutGrid },
    { id: 'email',         label: 'Gmail',          icon: Mail,            statusKey: 'gmail' },
    { id: 'whatsapp',      label: 'WhatsApp',       icon: MessageSquare,   statusKey: 'whatsapp' },
    { id: 'scheduled',     label: 'Scheduled WA',   icon: Clock },
    { id: 'zoom',          label: 'Zoom',           icon: Video,           statusKey: 'zoom' },
    { id: 'cloudinary',    label: 'Cloudinary',     icon: Cloud,           statusKey: 'cloudinary' },
    { id: 'ai',            label: 'AI',             icon: Sparkles,        statusKey: 'ai' },
    { id: 'sheets',        label: 'Google Sheets',  icon: FileSpreadsheet, statusKey: 'sheets' },
    { id: 'school_portal', label: 'School Portal',  icon: GraduationCap,   statusKey: 'school_portal' },
  ]},
  { label: 'System', items: [
    { id: 'field',         label: 'Field / Location', icon: MapPin },
    { id: 'devices',       label: 'Devices',          icon: Shield },
    { id: 'notifications', label: 'Notifications',    icon: Bell },
    { id: 'security',      label: 'Security',         icon: Lock },
  ]},
];

const ALL_ITEMS = GROUPS.flatMap(g => g.items);
const titleFor = (id) => (ALL_ITEMS.find(i => i.id === id) || {}).label || 'Settings';

export default function AppSettings() {
  const s = useAppSettings();
  const status = s.integrationStatus || {};

  const textPri = 'text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  if (s.loading) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent" />
      </div>
    </AdminLayout>
  );

  const Dot = ({ ok }) => (
    <span className={`ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0 ${ok ? 'bg-green-500' : 'bg-[var(--text-muted)]/40'}`} />
  );

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div>
          <h1 className={`text-3xl sm:text-4xl font-semibold ${textPri} tracking-tight`} data-testid="settings-title">Settings</h1>
          <p className={`${textSec} mt-1 text-sm`}>Company profile, integrations &amp; system preferences</p>
        </div>

        {/* Mobile: grouped dropdown */}
        <div className="lg:hidden">
          <select value={s.activeTab} onChange={e => s.setActiveTab(e.target.value)}
            className="w-full h-10 px-3 rounded-md text-sm bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)]"
            data-testid="settings-tab-select">
            {GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="lg:grid lg:grid-cols-[224px_1fr] lg:gap-6 lg:items-start">
          {/* Desktop: grouped left rail */}
          <nav className="hidden lg:block bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-2 sticky top-4 space-y-3">
            {GROUPS.map(group => (
              <div key={group.label}>
                <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{group.label}</p>
                {group.items.map(item => {
                  const Icon = item.icon;
                  const active = s.activeTab === item.id;
                  return (
                    <button key={item.id} onClick={() => s.setActiveTab(item.id)}
                      data-testid={`settings-tab-${item.id}`}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-[#e94560]/12 text-[#e94560]' : `${textSec} hover:bg-[var(--bg-hover)]`}`}>
                      <Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-[#e94560]' : ''}`} />
                      <span className="truncate">{item.label}</span>
                      {item.statusKey && <Dot ok={!!status?.[item.statusKey]?.configured} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Content */}
          <div className="min-w-0 mt-4 lg:mt-0">
            {s.activeTab === 'overview' && (
              <IntegrationsOverview status={status} onOpen={s.setActiveTab} />
            )}

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

            {s.activeTab === 'whatsapp' && (
              <div className="mb-4">
                <WhatsAppConnectionSection />
              </div>
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

            {s.activeTab === 'zoom' && (
              <ZoomSection configured={status?.zoom?.configured} onSaved={s.refreshStatus} />
            )}

            {s.activeTab === 'cloudinary' && (
              <CloudinarySection configured={status?.cloudinary?.configured} onSaved={s.refreshStatus} />
            )}

            {s.activeTab === 'sheets' && (
              <SheetsSection sheets={s.sheets} setSheets={s.setSheets} save={s.saveSheets}
                configured={status?.sheets?.configured} />
            )}

            {s.activeTab === 'notifications' && (
              <div className="space-y-4">
                <NotificationsSection prefs={s.notifPrefs} setPrefs={s.setNotifPrefs} save={s.saveNotifPrefs} />
                <DailyDigestSection />
                <OrdersReportSection />
              </div>
            )}

            {s.activeTab === 'school_portal' && (
              <SchoolPortalSection configured={status?.school_portal?.configured} onSaved={s.refreshStatus} />
            )}

            {s.activeTab === 'security' && <SecurityTab />}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
