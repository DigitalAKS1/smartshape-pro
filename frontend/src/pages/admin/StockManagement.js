import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/layouts/AdminLayout';
import { stock, dies, salesPersons } from '../../lib/api';
import { formatDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Plus, TrendingUp, TrendingDown, Users } from 'lucide-react';
import { toast } from 'sonner';

export default function StockManagement() {
  const [movements, setMovements] = useState([]);
  const [diesList, setDiesList] = useState([]);
  const [salesPersonsList, setSalesPersonsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [movementForm, setMovementForm] = useState({
    die_id: '',
    movement_type: 'stock_in',
    quantity: 0,
    sales_person_id: '',
    notes: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [movRes, diesRes, spRes] = await Promise.all([
        stock.getMovements(),
        dies.getAll(),
        salesPersons.getAll()
      ]);
      setMovements(movRes.data);
      setDiesList(diesRes.data);
      setSalesPersonsList(spRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMovement = async (e) => {
    e.preventDefault();
    try {
      await stock.createMovement(movementForm);
      toast.success('Stock movement recorded');
      setDialogOpen(false);
      setMovementForm({ die_id: '', movement_type: 'stock_in', quantity: 0, sales_person_id: '', notes: '' });
      fetchData();
    } catch (error) {
      console.error('Error creating movement:', error);
      toast.error('Failed to record movement');
    }
  };

  const getMovementIcon = (type) => {
    if (type === 'stock_in' || type === 'returned_from_sales') return <TrendingUp className="h-5 w-5 text-[#10b981]" />;
    if (type === 'stock_out' || type === 'allocated_to_sales') return <TrendingDown className="h-5 w-5 text-[#ef4444]" />;
    return <Users className="h-5 w-5 text-[#3b82f6]" />;
  };

  const stats = {
    total_movements: movements.length,
    stock_in: movements.filter(m => m.movement_type === 'stock_in').length,
    allocated: movements.filter(m => m.movement_type === 'allocated_to_sales').length,
  };

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight" data-testid="stock-management-title">Stock Management</h1>
            <p className="text-[var(--text-secondary)] mt-1">Track stock movements and allocations</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="add-movement-button">
                <Plus className="mr-2 h-4 w-4" /> Record Movement
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]">
              <DialogHeader>
                <DialogTitle className="text-[var(--text-primary)]">Record Stock Movement</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateMovement} className="space-y-4">
                <div>
                  <Label>Die</Label>
                  <select value={movementForm.die_id} onChange={(e) => setMovementForm({...movementForm, die_id: e.target.value})} required className="w-full h-10 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md">
                    <option value="">Select die</option>
                    {diesList.map(die => <option key={die.die_id} value={die.die_id}>{die.code} - {die.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Movement Type</Label>
                  <select value={movementForm.movement_type} onChange={(e) => setMovementForm({...movementForm, movement_type: e.target.value})} className="w-full h-10 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md">
                    <option value="stock_in">Stock In</option>
                    <option value="stock_out">Stock Out</option>
                    <option value="allocated_to_sales">Allocate to Sales Person</option>
                    <option value="returned_from_sales">Returned from Sales</option>
                  </select>
                </div>
                {movementForm.movement_type === 'allocated_to_sales' && (
                  <div>
                    <Label>Sales Person</Label>
                    <select value={movementForm.sales_person_id} onChange={(e) => setMovementForm({...movementForm, sales_person_id: e.target.value})} required className="w-full h-10 px-3 bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-md">
                      <option value="">Select sales person</option>
                      {salesPersonsList.map(sp => <option key={sp.sales_person_id} value={sp.sales_person_id}>{sp.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <Label>Quantity</Label>
                  <Input type="number" value={movementForm.quantity} onChange={(e) => setMovementForm({...movementForm, quantity: parseInt(e.target.value)})} required className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input value={movementForm.notes} onChange={(e) => setMovementForm({...movementForm, notes: e.target.value})} className="bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]" />
                </div>
                <Button type="submit" className="w-full bg-[#e94560] hover:bg-[#f05c75]">Record Movement</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="text-3xl font-mono font-bold text-[var(--text-primary)]">{stats.total_movements}</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Total Movements</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="text-3xl font-mono font-bold text-[#10b981]">{stats.stock_in}</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Stock In</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-6">
            <div className="text-3xl font-mono font-bold text-[#3b82f6]">{stats.allocated}</div>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Allocated to Sales</p>
          </div>
        </div>

        <Tabs defaultValue="history" className="space-y-6">
          <TabsList className="bg-[var(--bg-card)] border border-[var(--border-color)]">
            <TabsTrigger value="history" className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white">Movement History</TabsTrigger>
            <TabsTrigger value="holdings" className="data-[state=active]:bg-[#e94560] data-[state=active]:text-white">Sales Team Holdings</TabsTrigger>
          </TabsList>

          <TabsContent value="history">
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e94560] border-t-transparent"></div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full" data-testid="movements-table">
                    <thead className="bg-[var(--bg-primary)]/50">
                      <tr className="border-b border-[var(--border-color)]">
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Die Code</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Type</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Quantity</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Sales Person</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Date</th>
                        <th className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)] px-6 py-4">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((movement) => (
                        <tr key={movement.movement_id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)]" data-testid={`movement-row-${movement.movement_id}`}>
                          <td className="px-6 py-4 font-mono text-[#e94560] font-medium">{movement.die_code}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              {getMovementIcon(movement.movement_type)}
                              <span className="text-[var(--text-primary)] text-sm capitalize">{movement.movement_type.replace(/_/g, ' ')}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-mono text-[var(--text-primary)] font-bold">{movement.quantity}</td>
                          <td className="px-6 py-4 text-[var(--text-secondary)]">{movement.sales_person_name || '-'}</td>
                          <td className="px-6 py-4 text-[var(--text-secondary)]">{formatDate(movement.movement_date)}</td>
                          <td className="px-6 py-4 text-[var(--text-muted)] text-sm">{movement.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="holdings">
            <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-md p-12 text-center">
              <Users className="h-16 w-16 text-[var(--text-muted)] mx-auto mb-4" />
              <p className="text-[var(--text-muted)]">Sales team holdings feature coming soon</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}