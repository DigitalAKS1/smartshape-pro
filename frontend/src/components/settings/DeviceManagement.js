import React from 'react';
import { Button } from '../ui/button';
import { Save, Shield, ShieldOff, Laptop, Check, Trash2, Navigation } from 'lucide-react';

export default function DeviceManagement({
  devices, deviceCounts, deviceFilter, setDeviceFilter,
  devicePolicy, setDevicePolicy, devicePolicySaving, deviceLoading, deviceActioning,
  loadDevices, approveDevice, revokeDevice, removeDevice, saveDevicePolicy,
}) {
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  return (
    <div className="space-y-5">

      {/* Policy card */}
      <div className={`${card} border rounded-xl p-5`}>
        <h2 className={`text-lg font-semibold ${textPri} mb-1`}>Device Trust Policy</h2>
        <p className={`text-xs ${textMuted} mb-5`}>Control which devices employees are allowed to sign in from.</p>

        {/* enforcement_enabled */}
        <div className="flex items-center justify-between py-3.5 border-b border-[var(--border-color)]">
          <div>
            <p className={`text-sm font-medium ${textPri}`}>Enable Device Trust</p>
            <p className={`text-xs ${textMuted} mt-0.5`}>When on, employees can only log in from approved devices</p>
          </div>
          <button
            onClick={() => setDevicePolicy(p => ({ ...p, enforcement_enabled: !p.enforcement_enabled }))}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${devicePolicy.enforcement_enabled ? 'bg-[#e94560]' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${devicePolicy.enforcement_enabled ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* auto_approve_admin */}
        <div className="flex items-center justify-between py-3.5 border-b border-[var(--border-color)]">
          <div>
            <p className={`text-sm font-medium ${textPri}`}>Admin Bypass</p>
            <p className={`text-xs ${textMuted} mt-0.5`}>Admins skip device check — always allowed to log in (recommended)</p>
          </div>
          <button
            onClick={() => setDevicePolicy(p => ({ ...p, auto_approve_admin: !p.auto_approve_admin }))}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${devicePolicy.auto_approve_admin ? 'bg-[#e94560]' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${devicePolicy.auto_approve_admin ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* max_devices_per_user */}
        <div className="py-3.5 border-b border-[var(--border-color)]">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className={`text-sm font-medium ${textPri}`}>Max Approved Devices Per User</p>
              <p className={`text-xs ${textMuted}`}>Limit how many devices each employee can register</p>
            </div>
            <span className={`text-2xl font-bold ${textPri} w-8 text-right`}>{devicePolicy.max_devices_per_user}</span>
          </div>
          <input
            type="range" min="1" max="5" step="1"
            value={devicePolicy.max_devices_per_user}
            onChange={e => setDevicePolicy(p => ({ ...p, max_devices_per_user: parseInt(e.target.value) }))}
            className="w-full accent-[#e94560]"
          />
          <div className={`flex justify-between text-[10px] ${textMuted} mt-1 px-0.5`}>
            {[1,2,3,4,5].map(n => <span key={n}>{n}</span>)}
          </div>
        </div>

        <div className="pt-4 flex items-center gap-4">
          <Button onClick={saveDevicePolicy} disabled={devicePolicySaving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
            <Save className="mr-2 h-4 w-4" />{devicePolicySaving ? 'Saving…' : 'Save Policy'}
          </Button>
          {!devicePolicy.enforcement_enabled && (
            <p className="text-xs text-amber-400">Device trust is OFF — all logins are currently allowed</p>
          )}
          {devicePolicy.enforcement_enabled && (
            <p className="text-xs text-green-400">Device trust is ON — only approved devices can sign in</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Pending',  value: deviceCounts.pending,  color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30' },
          { label: 'Approved', value: deviceCounts.approved, color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30' },
          { label: 'Revoked',  value: deviceCounts.revoked,  color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30' },
          { label: 'Total',    value: deviceCounts.total,    color: textPri,            bg: `${card} border-[var(--border-color)]` },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border rounded-xl p-4 text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value ?? 0}</p>
            <p className={`text-xs ${textMuted} mt-0.5`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Device list */}
      <div className={`${card} border rounded-xl overflow-hidden`}>
        {/* Filter bar */}
        <div className="p-3 border-b border-[var(--border-color)] flex items-center gap-2 flex-wrap">
          {['all', 'pending', 'approved', 'revoked'].map(f => (
            <button key={f} onClick={() => { setDeviceFilter(f); loadDevices(f); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${deviceFilter === f ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)] border border-[var(--border-color)]`}`}>
              {f}
              {f === 'pending' && deviceCounts.pending > 0 && (
                <span className="ml-1.5 bg-amber-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">{deviceCounts.pending}</span>
              )}
            </button>
          ))}
          <button onClick={() => loadDevices()} className={`ml-auto text-xs ${textMuted} hover:${textSec} flex items-center gap-1`}>
            <Navigation className="h-3 w-3" />Refresh
          </button>
        </div>

        {deviceLoading ? (
          <div className="flex justify-center py-14">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-[#e94560] border-t-transparent" />
          </div>
        ) : devices.length === 0 ? (
          <div className="py-14 text-center">
            <Shield className={`h-10 w-10 ${textMuted} mx-auto mb-3 opacity-40`} />
            <p className={`${textSec} text-sm`}>No devices found</p>
            <p className={`${textMuted} text-xs mt-1`}>Devices appear here when employees attempt to sign in</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]">
            {devices.map(dev => (
              <div key={dev.device_id} className={`p-4 ${dev.status === 'pending' ? 'bg-amber-500/5' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  {/* Left: icon + info */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      dev.status === 'approved' ? 'bg-green-500/20' :
                      dev.status === 'revoked'  ? 'bg-red-500/20'   :
                      'bg-amber-500/20'
                    }`}>
                      <Laptop className={`h-4 w-4 ${
                        dev.status === 'approved' ? 'text-green-400' :
                        dev.status === 'revoked'  ? 'text-red-400'   :
                        'text-amber-400'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-semibold ${textPri}`}>{dev.user_name}</span>
                        <span className={`text-xs ${textMuted}`}>{dev.user_email}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          dev.role === 'admin' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                        }`}>{dev.role}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          dev.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                          dev.status === 'revoked'  ? 'bg-red-500/20 text-red-400'     :
                          'bg-amber-500/20 text-amber-400'
                        }`}>{dev.status}</span>
                      </div>
                      <p className={`text-xs ${textSec} mt-0.5`}>{dev.device_label}</p>
                      <div className={`flex items-center gap-3 flex-wrap text-[10px] ${textMuted} mt-1`}>
                        <span>Requested: {dev.requested_at?.slice(0, 10)}</span>
                        {dev.last_used && <span>Last used: {dev.last_used?.slice(0, 10)}</span>}
                        {dev.last_ip && <span>IP: {dev.last_ip}</span>}
                        {dev.approved_by && <span>Approved by: {dev.approved_by}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {(dev.status === 'pending' || dev.status === 'revoked') && (
                      <Button size="sm" onClick={() => approveDevice(dev.device_id)}
                        disabled={deviceActioning === dev.device_id}
                        className="bg-green-500 hover:bg-green-600 text-white h-7 px-2.5 text-xs">
                        <Check className="h-3 w-3 mr-1" />
                        {dev.status === 'revoked' ? 'Re-approve' : 'Approve'}
                      </Button>
                    )}
                    {dev.status === 'pending' && (
                      <Button size="sm" variant="outline" onClick={() => revokeDevice(dev.device_id)}
                        disabled={deviceActioning === dev.device_id}
                        className="h-7 px-2.5 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10">
                        Reject
                      </Button>
                    )}
                    {dev.status === 'approved' && (
                      <Button size="sm" variant="outline" onClick={() => revokeDevice(dev.device_id)}
                        disabled={deviceActioning === dev.device_id}
                        className="h-7 px-2.5 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10">
                        <ShieldOff className="h-3 w-3 mr-1" />Revoke
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeDevice(dev.device_id)}
                      disabled={deviceActioning === dev.device_id}
                      className={`h-7 w-7 p-0 ${textMuted} hover:text-red-400`}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* How it works */}
      <div className={`${card} border rounded-xl p-5`}>
        <h3 className={`text-sm font-semibold ${textPri} mb-3`}>How Device Trust Works</h3>
        <ul className={`space-y-2 text-xs ${textSec}`}>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">1.</span>When an employee logs in from a new device, it appears here as "Pending" and they are blocked with a friendly message.</li>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">2.</span>Admin approves the device above — the employee can then log in normally from that device.</li>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">3.</span>Revoking a device blocks the user the next time they try to log in from it.</li>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">4.</span>Works on web now. Future mobile app devices (Android / iOS) will appear here automatically — same backend, same approval flow.</li>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">5.</span>Device Trust is OFF by default. Enable it above when you're ready to enforce it — existing employees will need their devices approved.</li>
        </ul>
      </div>
    </div>
  );
}
