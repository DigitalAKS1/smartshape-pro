import React, { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle } from 'lucide-react';
import { getQueueCount, flushQueue } from '../lib/offlineQueue';
import { toast } from 'sonner';

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const [showSynced, setShowSynced] = useState(false);

  const refreshCount = useCallback(async () => {
    const count = await getQueueCount();
    setPendingCount(count);
  }, []);

  const handleFlush = useCallback(async () => {
    if (!navigator.onLine || flushing) return;
    setFlushing(true);
    const base = process.env.REACT_APP_BACKEND_URL + '/api';
    const result = await flushQueue(base);
    setFlushing(false);
    await refreshCount();
    if (result.flushed > 0) {
      setShowSynced(true);
      toast.success(`Synced ${result.flushed} offline action${result.flushed !== 1 ? 's' : ''}`);
      setTimeout(() => setShowSynced(false), 3000);
    }
    if (result.failed > 0) {
      toast.error(`${result.failed} action${result.failed !== 1 ? 's' : ''} failed to sync`);
    }
  }, [flushing, refreshCount]);

  useEffect(() => {
    refreshCount();
    const onOnline = () => {
      setIsOnline(true);
      // Auto-flush when coming back online
      setTimeout(() => handleFlush(), 1500);
    };
    const onOffline = () => { setIsOnline(false); refreshCount(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Listen for SW sync messages
    const handleMessage = (e) => {
      if (e.data?.type === 'ssp-sync') handleFlush();
    };
    navigator.serviceWorker?.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, [handleFlush, refreshCount]);

  if (isOnline && pendingCount === 0 && !showSynced) return null;

  if (isOnline && showSynced) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-[#10b981] text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg animate-in fade-in">
        <CheckCircle className="h-4 w-4" />Offline actions synced
      </div>
    );
  }

  if (isOnline && pendingCount > 0) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#f59e0b] text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg">
        <Wifi className="h-4 w-4" />
        <span>{pendingCount} action{pendingCount !== 1 ? 's' : ''} pending sync</span>
        <button
          onClick={handleFlush}
          disabled={flushing}
          className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded-full text-xs transition"
        >
          <RefreshCw className={`h-3 w-3 ${flushing ? 'animate-spin' : ''}`} />
          {flushing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    );
  }

  // Offline
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#1a1a2e] border-t border-[#e94560]/30 px-4 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-[#f87171]">
        <WifiOff className="h-4 w-4" />
        <span className="font-medium">You're offline</span>
        <span className="text-[var(--text-muted)] hidden sm:inline">— Actions will sync when back online</span>
      </div>
      {pendingCount > 0 && (
        <span className="text-[#f59e0b] text-xs font-medium">{pendingCount} queued</span>
      )}
    </div>
  );
}
