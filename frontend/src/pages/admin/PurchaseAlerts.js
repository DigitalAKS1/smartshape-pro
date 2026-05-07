import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { alerts } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function PurchaseAlerts() {
  const [pendingAlerts, setPendingAlerts] = useState([]);
  const [orderedAlerts, setOrderedAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = async () => {
    try {
      const [pendingRes, orderedRes] = await Promise.all([
        alerts.getAll('pending'),
        alerts.getAll('ordered')
      ]);
      setPendingAlerts(pendingRes.data);
      setOrderedAlerts(orderedRes.data);
    } catch (error) {
      console.error('Error fetching alerts:', error);
      toast.error('Failed to load alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const handleMarkAsOrdered = async (alertId) => {
    try {
      await alerts.updateStatus(alertId, 'ordered');
      toast.success('Alert marked as ordered');
      fetchAlerts();
    } catch (error) {
      console.error('Error updating alert:', error);
      toast.error('Failed to update alert');
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      urgent: 'bg-red-500/20 text-red-300 border-red-500/30',
      high: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
      normal: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    };
    return colors[priority] || colors.normal;
  };

  const AlertsTable = ({ alertsList, showActions = false, title }) => (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--border-color)]">
        <h2 className="text-xl font-medium text-[var(--text-primary)]">{title}</h2>
      </div>
      {alertsList.length === 0 ? (
        <div className="text-center py-12">
          <AlertTriangle className="h-16 w-16 text-[var(--text-muted)] mx-auto mb-4" />
          <p className="text-[var(--text-muted)]">No {title.toLowerCase()}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--bg-primary)]/50">
              <tr className="border-b border-[var(--border-color)]">
                <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Die Code</th>
                <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Die Name</th>
                <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Type</th>
                <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Current Stock</th>
                <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Shortage</th>
                <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Priority</th>
                {showActions && <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {alertsList.map((alert) => (
                <tr key={alert.alert_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]" data-testid={`alert-row-${alert.die_code}`}>
                  <td className="px-6 py-4 font-mono text-[#e94560] font-medium">{alert.die_code}</td>
                  <td className="px-6 py-4 text-[var(--text-primary)]">{alert.die_name}</td>
                  <td className="px-6 py-4 text-[var(--text-secondary)] capitalize">{alert.die_type}</td>
                  <td className="px-6 py-4 font-mono text-[var(--text-primary)]">{alert.current_stock}</td>
                  <td className="px-6 py-4 font-mono text-[#ef4444] font-bold">{alert.shortage_qty}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${getPriorityColor(alert.priority)}`}>
                      {alert.priority}
                    </span>
                  </td>
                  {showActions && (
                    <td className="px-6 py-4">
                      <Button size="sm" onClick={() => handleMarkAsOrdered(alert.alert_id)} className="bg-[#10b981] hover:bg-[#059669] text-white" data-testid={`mark-ordered-${alert.die_code}`}>
                        <CheckCircle className="mr-2 h-3 w-3" /> Mark as Ordered
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="purchase-alerts-title">Purchase Alerts</h1>
          <p className="text-[var(--text-secondary)] mt-1">Manage stock shortage alerts and purchase orders</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent"></div>
          </div>
        ) : (
          <div className="space-y-8">
            <AlertsTable alertsList={pendingAlerts} showActions={true} title="Pending Alerts" />
            <AlertsTable alertsList={orderedAlerts} showActions={false} title="Ordered Alerts" />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}