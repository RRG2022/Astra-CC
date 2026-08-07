import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useUIStore } from '../lib/stores/useUIStore';
import { apiFetch } from '../lib/api';

export default function SettingsModal() {
  const { showSettings, setShowSettings, showToast } = useUIStore();
  
  const [settingsForm, setSettingsForm] = useState({ openai: '', anthropic: '', gemini: '' });
  const [authorityLevel, setAuthorityLevel] = useState(() => localStorage.getItem('astra_authority_level') || 'Supervised');

  // Load settings on mount
  useEffect(() => {
    if (!showSettings) return;
    apiFetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data && data.apiKeys) {
          setSettingsForm(data.apiKeys);
        }
      })
      .catch(err => console.error('Error fetching settings:', err));
  }, [showSettings]);

  if (!showSettings) return null;

  const handleSave = () => {
    apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKeys: settingsForm })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        showToast('Settings saved successfully');
        setShowSettings(false);
      }
    });
  };

  return (
    <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content" style={{ background: 'var(--bg-color)', padding: '1.5rem', borderRadius: '8px', width: '400px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Settings</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>OpenAI API Key</label>
          <input type="password" value={settingsForm.openai || ''} onChange={e => setSettingsForm({...settingsForm, openai: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Anthropic API Key</label>
          <input type="password" value={settingsForm.anthropic || ''} onChange={e => setSettingsForm({...settingsForm, anthropic: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gemini API Key</label>
          <input type="password" value={settingsForm.gemini || ''} onChange={e => setSettingsForm({...settingsForm, gemini: e.target.value})} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Agent Authority Level</label>
          <select value={authorityLevel} onChange={e => {
            setAuthorityLevel(e.target.value);
            localStorage.setItem('astra_authority_level', e.target.value);
          }} style={{ background: 'var(--surface-color)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem', borderRadius: '4px' }}>
            <option value="Strict">Strict (Approve everything)</option>
            <option value="Supervised">Supervised (Approve modifying tools)</option>
            <option value="Autonomous">Autonomous (No approval required)</option>
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} style={{ background: 'var(--text-primary)', border: 'none', color: 'var(--bg-color)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
        </div>
      </div>
    </div>
  );
}
