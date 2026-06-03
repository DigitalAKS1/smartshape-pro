import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Save, MapPin, Navigation } from 'lucide-react';

/**
 * ModuleToggles — Field Settings tab content (office location & geofence).
 *
 * The original file had no explicit "module toggles" section separate from
 * the field/geofence config, so this component covers that tab which is the
 * closest match to a toggles/config section.
 */
export default function ModuleToggles({
  officeLocation, setOfficeLocation,
  officeLocating, officeSaving,
  captureOfficeLocation, saveOfficeLocation,
}) {
  const card      = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls  = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textPri   = 'text-[var(--text-primary)]';
  const textSec   = 'text-[var(--text-secondary)]';
  const textMuted = 'text-[var(--text-muted)]';

  return (
    <div className="space-y-6">
      <div className={`${card} border rounded-xl p-6`}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-[#e94560]/15 flex items-center justify-center">
            <MapPin className="h-5 w-5 text-[#e94560]" />
          </div>
          <div>
            <h2 className={`text-lg font-semibold ${textPri}`}>Office Location &amp; Geofence</h2>
            <p className={`text-xs ${textMuted}`}>Set your office location to auto-detect attendance mode and flag out-of-area check-ins</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* GPS capture button */}
          <Button onClick={captureOfficeLocation} disabled={officeLocating} variant="outline" className="border-[var(--border-color)] text-[var(--text-secondary)] w-full sm:w-auto">
            <Navigation className={`mr-2 h-4 w-4 ${officeLocating ? 'animate-spin' : ''}`} />
            {officeLocating ? 'Capturing GPS…' : 'Use My Current Location as Office'}
          </Button>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className={`${textSec} text-xs`}>Office Latitude</Label>
              <Input
                value={officeLocation.office_lat}
                onChange={e => setOfficeLocation(p => ({...p, office_lat: e.target.value}))}
                className={inputCls} placeholder="e.g. 28.6139" type="number" step="any"
              />
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Office Longitude</Label>
              <Input
                value={officeLocation.office_lng}
                onChange={e => setOfficeLocation(p => ({...p, office_lng: e.target.value}))}
                className={inputCls} placeholder="e.g. 77.2090" type="number" step="any"
              />
            </div>
          </div>

          <div>
            <Label className={`${textSec} text-xs`}>Office Address (auto-filled or manual)</Label>
            <Input
              value={officeLocation.office_address}
              onChange={e => setOfficeLocation(p => ({...p, office_address: e.target.value}))}
              className={inputCls} placeholder="Full office address"
            />
          </div>

          <div>
            <Label className={`${textSec} text-xs`}>Geofence Radius (meters)</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="range" min="50" max="2000" step="50"
                value={officeLocation.office_radius_m}
                onChange={e => setOfficeLocation(p => ({...p, office_radius_m: parseInt(e.target.value)}))}
                className="flex-1 accent-[#e94560]"
              />
              <span className={`${textPri} font-mono font-semibold text-sm w-20 text-right`}>{officeLocation.office_radius_m}m</span>
            </div>
            <p className={`text-xs ${textMuted} mt-1`}>Employees who check in as "Office" but are farther than this from the office coordinates will trigger a geofence alert.</p>
          </div>

          {officeLocation.office_lat && officeLocation.office_lng && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-start gap-2">
              <MapPin className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-green-400 text-xs font-semibold">Office Location Set</p>
                <p className={`${textSec} text-xs mt-0.5`}>{officeLocation.office_address || `${officeLocation.office_lat}, ${officeLocation.office_lng}`}</p>
                <p className={`${textMuted} text-xs`}>Geofence radius: {officeLocation.office_radius_m}m</p>
              </div>
            </div>
          )}

          <Button onClick={saveOfficeLocation} disabled={officeSaving} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
            <Save className="mr-2 h-4 w-4" />{officeSaving ? 'Saving…' : 'Save Office Location'}
          </Button>
        </div>
      </div>

      {/* How it works */}
      <div className={`${card} border rounded-xl p-5`}>
        <h3 className={`text-sm font-semibold ${textPri} mb-3`}>How Geo-Tagging Works</h3>
        <ul className={`space-y-2 text-xs ${textSec}`}>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">1.</span>Admin sets the office GPS coordinates and geofence radius above.</li>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">2.</span>When a sales rep checks into attendance as "Office", their GPS is compared with the office location.</li>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">3.</span>If they are farther than the geofence radius, a breach alert is created and visible in Field Sales → Geo Alerts.</li>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">4.</span>When employees log in, their location is captured and work mode (Office / WFH) is auto-detected.</li>
          <li className="flex items-start gap-2"><span className="text-[#e94560] font-bold mt-0.5">5.</span>Login logs with location data are viewable in Field Sales → Login Logs.</li>
        </ul>
      </div>
    </div>
  );
}
