import React, { useState, useEffect } from 'react';
import SalesLayout from '../../components/layouts/SalesLayout';
import { visits as visitsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Plus, MapPin, Check, Calendar, MapPinned } from 'lucide-react';
import { getStatusColor } from '../../lib/utils';
import { toast } from 'sonner';

export default function SalesVisits() {
  const [visits, setVisits] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [visitForm, setVisitForm] = useState({
    school_name: '',
    contact_person: '',
    contact_phone: '',
    visit_date: new Date().toISOString().split('T')[0],
    visit_time: '10:00',
    purpose: '',
    planned_address: ''
  });
  const [gettingLocation, setGettingLocation] = useState(false);

  useEffect(() => {
    fetchVisits();
  }, []);

  const fetchVisits = async () => {
    try {
      const res = await visitsApi.getAll();
      setVisits(res.data);
    } catch (error) {
      console.error('Error fetching visits:', error);
    }
  };

  const getLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve(null)
      );
    });
  };

  const handleGetCurrentLocation = async () => {
    setGettingLocation(true);
    try {
      const location = await getLocation();
      if (!location) {
        toast.error('Could not get your location. Please enable GPS.');
        setGettingLocation(false);
        return;
      }
      
      // Reverse geocode to get address
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${location.lat}&lon=${location.lng}&format=json`, {
        headers: { 'User-Agent': 'SmartShapePro/1.0' }
      });
      const data = await response.json();
      const address = data.display_name || `${location.lat}, ${location.lng}`;
      
      setVisitForm({
        ...visitForm,
        planned_address: address
      });
      
      // Store coordinates temporarily for submission
      visitForm.temp_lat = location.lat;
      visitForm.temp_lng = location.lng;
      
      toast.success('Location captured!');
    } catch (error) {
      console.error('Error getting location:', error);
      toast.error('Failed to get location');
    } finally {
      setGettingLocation(false);
    }
  };

  const handleCreateVisit = async (e) => {
    e.preventDefault();
    try {
      await visitsApi.create({
        school_name: visitForm.school_name,
        contact_person: visitForm.contact_person,
        contact_phone: visitForm.contact_phone,
        visit_date: visitForm.visit_date,
        visit_time: visitForm.visit_time,
        purpose: visitForm.purpose,
        lat: visitForm.temp_lat,
        lng: visitForm.temp_lng
      });
      toast.success('Visit planned successfully!');
      setDialogOpen(false);
      setVisitForm({
        school_name: '',
        contact_person: '',
        contact_phone: '',
        visit_date: new Date().toISOString().split('T')[0],
        visit_time: '10:00',
        purpose: '',
        planned_address: ''
      });
      fetchVisits();
    } catch (error) {
      console.error('Error creating visit:', error);
      toast.error('Failed to plan visit');
    }
  };

  const handleCheckIn = async (visitId) => {
    try {
      const location = await getLocation();
      if (!location) {
        toast.error('Could not get your location. Please enable GPS.');
        return;
      }
      await visitsApi.checkIn(visitId, location.lat, location.lng);
      toast.success('Checked in at visit!');
      fetchVisits();
    } catch (error) {
      console.error('Error checking in:', error);
      toast.error('Failed to check in');
    }
  };

  return (
    <SalesLayout title="My Visits" showBack>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]" data-testid="visits-title">Field Visits</h1>
            <p className="text-[var(--text-secondary)] mt-1">Plan and track your visits</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="plan-visit-button">
                <Plus className="mr-2 h-4 w-4" /> Plan Visit
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] max-w-md">
              <DialogHeader>
                <DialogTitle className="text-[var(--text-primary)]">Plan New Visit</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateVisit} className="space-y-4">
                <div>
                  <Label>School Name</Label>
                  <Input value={visitForm.school_name} onChange={(e) => setVisitForm({...visitForm, school_name: e.target.value})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <div>
                  <Label>Contact Person</Label>
                  <Input value={visitForm.contact_person} onChange={(e) => setVisitForm({...visitForm, contact_person: e.target.value})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <div>
                  <Label>Contact Phone</Label>
                  <Input value={visitForm.contact_phone} onChange={(e) => setVisitForm({...visitForm, contact_phone: e.target.value})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <div>
                  <Label>Location Address</Label>
                  <div className="space-y-2">
                    <Input
                      value={visitForm.planned_address}
                      onChange={(e) => setVisitForm({...visitForm, planned_address: e.target.value})}
                      className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                      placeholder="Enter address or use current location"
                    />
                    <Button
                      type="button"
                      onClick={handleGetCurrentLocation}
                      disabled={gettingLocation}
                      variant="outline"
                      size="sm"
                      className="w-full border-[var(--border-color)] text-[var(--text-primary)]"
                      data-testid="get-current-location-button"
                    >
                      {gettingLocation ? 'Getting location...' : (
                        <><MapPinned className="mr-2 h-4 w-4" /> Use Current Location</>
                      )}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Date</Label>
                    <Input type="date" value={visitForm.visit_date} onChange={(e) => setVisitForm({...visitForm, visit_date: e.target.value})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                  </div>
                  <div>
                    <Label>Time</Label>
                    <Input type="time" value={visitForm.visit_time} onChange={(e) => setVisitForm({...visitForm, visit_time: e.target.value})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                  </div>
                </div>
                <div>
                  <Label>Purpose</Label>
                  <Input value={visitForm.purpose} onChange={(e) => setVisitForm({...visitForm, purpose: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <Button type="submit" className="w-full bg-[#e94560] hover:bg-[#f05c75]">Plan Visit</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Visits List */}
        <div className="space-y-3">
          {visits.length === 0 ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-12 text-center">
              <MapPin className="h-16 w-16 text-[var(--text-muted)] mx-auto mb-4" />
              <p className="text-[var(--text-muted)]">No visits planned yet</p>
            </div>
          ) : (
            visits.map((visit) => (
              <div key={visit.visit_id} className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-4" data-testid={`visit-card-${visit.visit_id}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-[var(--text-primary)]">{visit.school_name}</h3>
                    <p className="text-sm text-[var(--text-secondary)] mt-1">{visit.contact_person} • {visit.contact_phone}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(visit.status)}`}>
                    {visit.status}
                  </span>
                </div>
                <div className="flex items-center space-x-4 text-sm text-[var(--text-secondary)] mb-3">
                  <div className="flex items-center space-x-1">
                    <Calendar className="h-4 w-4" />
                    <span>{visit.visit_date}</span>
                  </div>
                  <div>{visit.visit_time}</div>
                </div>
                {visit.purpose && (
                  <p className="text-sm text-[var(--text-muted)] mb-3">Purpose: {visit.purpose}</p>
                )}
                {visit.status === 'planned' && (
                  <Button
                    onClick={() => handleCheckIn(visit.visit_id)}
                    className="w-full bg-[#10b981] hover:bg-[#059669] text-white"
                    data-testid={`check-in-visit-${visit.visit_id}`}
                  >
                    <Check className="mr-2 h-4 w-4" /> Check In at This Location
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </SalesLayout>
  );
}