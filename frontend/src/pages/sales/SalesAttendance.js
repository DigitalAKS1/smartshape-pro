import React, { useState, useEffect } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { attendance as attendanceApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Calendar, MapPin, LogIn, LogOut, Clock } from 'lucide-react';
import { formatDate } from '../../lib/utils';
import { toast } from 'sonner';

export default function SalesAttendance() {
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [workType, setWorkType] = useState('field');
  const [loading, setLoading] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);

  useEffect(() => {
    fetchAttendance();
  }, []);

  const fetchAttendance = async () => {
    try {
      const [todayRes, historyRes] = await Promise.all([
        attendanceApi.getToday(),
        attendanceApi.getAll()
      ]);
      setTodayAttendance(todayRes.data);
      setAttendanceHistory(historyRes.data);
    } catch (error) {
      console.error('Error fetching attendance:', error);
    }
  };

  const getLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported'));
        return;
      }
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          reject(error);
        }
      );
    });
  };

  const handleCheckIn = async () => {
    setGettingLocation(true);
    try {
      let location = null;
      if (workType === 'field') {
        try {
          location = await getLocation();
        } catch (gpsErr) {
          toast.error('GPS denied. Switch to WFH to check in without location, or enable location in browser settings.');
          setGettingLocation(false);
          return;
        }
      }
      setLoading(true);
      await attendanceApi.checkIn({
        work_type: workType,
        ...(location ? { lat: location.lat, lng: location.lng } : {}),
      });
      toast.success('Checked in successfully!');
      fetchAttendance();
    } catch (error) {
      console.error('Error checking in:', error);
      toast.error(error?.response?.data?.detail || 'Check-in failed. Please try again.');
    } finally {
      setLoading(false);
      setGettingLocation(false);
    }
  };

  const handleCheckOut = async () => {
    setGettingLocation(true);
    try {
      let lat, lng;
      try {
        const location = await getLocation();
        lat = location.lat;
        lng = location.lng;
      } catch {
        // GPS optional for checkout
      }
      setLoading(true);
      if (lat !== undefined) {
        await attendanceApi.checkOut(lat, lng);
      } else {
        await attendanceApi.checkOut(0, 0);
      }
      toast.success('Checked out successfully!');
      fetchAttendance();
    } catch (error) {
      console.error('Error checking out:', error);
      toast.error(error?.response?.data?.detail || 'Check-out failed. Please try again.');
    } finally {
      setLoading(false);
      setGettingLocation(false);
    }
  };

  return (
    <SalesLayout title="Attendance" showBack>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]" data-testid="attendance-title">Attendance</h1>
          <p className="text-[var(--text-secondary)] mt-1">Mark your attendance with GPS tracking</p>
        </div>

        {/* Today's Attendance */}
        {todayAttendance ? (
          <div className="bg-[#10b981]/10 border border-[#10b981]/30 rounded-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--text-secondary)]">Checked In</p>
                <p className="text-2xl font-bold text-[var(--text-primary)]">
                  {new Date(todayAttendance.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
                <p className="text-xs text-[#10b981] capitalize mt-1">{todayAttendance.work_type.replace('_', ' ')}</p>
              </div>
              <Clock className="h-12 w-12 text-[#10b981]" />
            </div>
            
            {todayAttendance.check_in_address && (
              <div className="flex items-start space-x-2 text-sm">
                <MapPin className="h-4 w-4 text-[var(--text-secondary)] mt-0.5 flex-shrink-0" />
                <p className="text-[var(--text-secondary)]">{todayAttendance.check_in_address}</p>
              </div>
            )}

            {todayAttendance.check_out_time ? (
              <div className="border-t border-[#10b981]/30 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">Checked Out</p>
                    <p className="text-2xl font-bold text-[var(--text-primary)]">
                      {new Date(todayAttendance.check_out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <Button
                onClick={handleCheckOut}
                disabled={loading || gettingLocation}
                className="w-full bg-[#ef4444] hover:bg-[#dc2626] text-white"
                data-testid="check-out-button"
              >
                {gettingLocation ? 'Getting location...' : loading ? 'Checking out...' : (
                  <><LogOut className="mr-2 h-4 w-4" /> Check Out</>
                )}
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6 space-y-6">
            <div>
              <h2 className="text-lg font-medium text-[var(--text-primary)] mb-4">Select Work Type</h2>
              <div className="grid grid-cols-3 gap-3">
                {['field', 'work_from_home', 'office'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setWorkType(type)}
                    className={`p-4 rounded-md border transition-all ${
                      workType === type
                        ? 'bg-[#e94560] border-[#e94560] text-white'
                        : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[#e94560]'
                    }`}
                    data-testid={`work-type-${type}`}
                  >
                    <p className="text-sm font-medium capitalize">{type.replace('_', ' ')}</p>
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleCheckIn}
              disabled={loading || gettingLocation}
              className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white h-14 text-lg"
              data-testid="check-in-button"
            >
              {gettingLocation ? 'Getting your location...' : loading ? 'Checking in...' : (
                <><LogIn className="mr-2 h-5 w-5" /> Check In Now</>
              )}
            </Button>
            
            <p className="text-xs text-center text-[var(--text-muted)]">
              {gettingLocation ? 'Please wait while we get your GPS location...' : 'We\'ll capture your GPS location when you check in'}
            </p>
          </div>
        )}

        {/* Attendance History */}
        <div>
          <h2 className="text-xl font-medium text-[var(--text-primary)] mb-4">Recent Attendance</h2>
          <div className="space-y-3">
            {attendanceHistory.slice(0, 10).map((record) => (
              <div key={record.attendance_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4" data-testid={`attendance-record-${record.date}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-3">
                    <Calendar className="h-5 w-5 text-[#e94560]" />
                    <div>
                      <p className="text-[var(--text-primary)] font-medium">{formatDate(record.date)}</p>
                      <p className="text-xs text-[var(--text-secondary)] capitalize">{record.work_type.replace('_', ' ')}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-[var(--text-primary)]">
                      {new Date(record.check_in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      {record.check_out_time && (
                        <> - {new Date(record.check_out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</>
                      )}
                    </p>
                  </div>
                </div>
                {record.check_in_address && (
                  <div className="flex items-start space-x-2 text-xs mt-2">
                    <MapPin className="h-3 w-3 text-[var(--text-muted)] mt-0.5 flex-shrink-0" />
                    <p className="text-[var(--text-muted)]">{record.check_in_address}</p>
                  </div>
                )}
                {record.check_in_lat && record.check_in_lng && (
                  <a
                    href={`https://www.google.com/maps?q=${record.check_in_lat},${record.check_in_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#e94560] hover:text-[#f05c75] mt-2 inline-block"
                  >
                    View on Google Maps →
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SalesLayout>
  );
}