import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useUIStore } from '../lib/stores/useUIStore';
import { apiFetch } from '../lib/api';

export default function ToastOverlay() {
  const { toastNotification, setToastNotification } = useUIStore();
  const [activeDownloads, setActiveDownloads] = useState({});

  // Poll for active downloads
  useEffect(() => {
    const interval = setInterval(() => {
      apiFetch('/api/plugins/downloads')
        .then(res => res.json())
        .then(data => {
          if (data && data.success) {
            setActiveDownloads(data.downloads || {});
          }
        })
        .catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-hide toast
  useEffect(() => {
    if (toastNotification) {
      const timer = setTimeout(() => {
        setToastNotification(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toastNotification]);

  return (
    <>
      {/* Active Downloads */}
      {Object.keys(activeDownloads).length > 0 && (
        <div style={{ position: 'fixed', bottom: '1rem', left: '1rem', zIndex: 500, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {Object.entries(activeDownloads).map(([model, info]) => (
            <div key={model} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.75rem', color: 'var(--text-primary)', fontSize: '0.8rem', width: '250px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Downloading {model}</strong>
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                {info.status}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast Notification */}
      {toastNotification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'var(--bg-color)',
          border: '1px solid var(--border-color)',
          borderLeft: '4px solid #f1c40f',
          padding: '1rem',
          borderRadius: '4px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          animation: 'slideInRight 0.3s ease-out'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2rem' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{toastNotification.title}</span>
            <button onClick={() => setToastNotification(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}><X size={14} /></button>
          </div>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{toastNotification.message}</span>
        </div>
      )}
    </>
  );
}
