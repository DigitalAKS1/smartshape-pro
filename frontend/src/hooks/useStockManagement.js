import { useState, useEffect } from 'react';
import { stock, dies, salesPersons } from '../lib/api';
import { toast } from 'sonner';

export const MOVEMENT_LABELS = {
  stock_in: 'Stock In',
  stock_out: 'Stock Out',
  allocated_to_sales: 'Allocated',
  returned_from_sales: 'Returned',
  physical_adjustment: 'Adjustment',
  purchase_in: 'Purchase In',
  returnable_in: 'Returned to stock',
  returnable_out: 'Out (returnable)',
};

export const MOVEMENT_COLORS = {
  stock_in: 'text-green-500',
  stock_out: 'text-red-400',
  allocated_to_sales: 'text-blue-400',
  returned_from_sales: 'text-purple-400',
  physical_adjustment: 'text-yellow-500',
  purchase_in: 'text-emerald-500',
  returnable_in: 'text-green-500',
  returnable_out: 'text-red-400',
};

export function useStockManagement() {
  const [movements, setMovements] = useState([]);
  const [diesList, setDiesList] = useState([]);
  const [salesPersonsList, setSalesPersonsList] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('history');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedSp, setExpandedSp] = useState(null);
  const [movementForm, setMovementForm] = useState({
    die_id: '', movement_type: 'stock_in', quantity: 1, sales_person_id: '', notes: '',
  });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const [movRes, diesRes, spRes] = await Promise.all([
        stock.getMovements(), dies.getAll(), salesPersons.getAll(),
      ]);
      setMovements(movRes.data);
      setDiesList(diesRes.data);
      setSalesPersonsList(spRes.data);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const fetchHoldings = async () => {
    setHoldingsLoading(true);
    try {
      const res = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/api/sales-person-stock`,
        { credentials: 'include' }
      );
      const data = await res.json();
      setHoldings(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Failed to load holdings');
    } finally {
      setHoldingsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'holdings') fetchHoldings();
  }, [activeTab]); // eslint-disable-line

  const handleCreateMovement = async (e) => {
    e.preventDefault();
    if (!movementForm.die_id) { toast.error('Select a die'); return; }
    if (movementForm.movement_type === 'allocated_to_sales' && !movementForm.sales_person_id) {
      toast.error('Select a sales person');
      return;
    }
    try {
      await stock.createMovement({ ...movementForm, quantity: Number(movementForm.quantity) });
      toast.success('Stock movement recorded');
      setDialogOpen(false);
      setMovementForm({ die_id: '', movement_type: 'stock_in', quantity: 1, sales_person_id: '', notes: '' });
      fetchData();
      if (activeTab === 'holdings') fetchHoldings();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to record movement');
    }
  };

  const stats = {
    total: movements.length,
    stockIn: movements.filter(m => m.movement_type === 'stock_in').length,
    stockOut: movements.filter(m => m.movement_type === 'stock_out').length,
    allocated: movements.filter(m => m.movement_type === 'allocated_to_sales').length,
  };

  const totalHeld = holdings.reduce((s, h) => s + (h.total_units || 0), 0);

  return {
    movements, diesList, salesPersonsList, holdings,
    loading, holdingsLoading,
    activeTab, setActiveTab,
    dialogOpen, setDialogOpen,
    expandedSp, setExpandedSp,
    movementForm, setMovementForm,
    stats, totalHeld,
    handleCreateMovement,
    fetchData,
  };
}
