import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { publicForms } from '../lib/api';

const ACCENT = '#e94560';

export default function PublicForm() {
  const { token } = useParams();
  const [form, setForm] = useState(null);
  const [state, setState] = useState('loading'); // loading|open|closed|missing|done
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [thanks, setThanks] = useState(null);
  const [hp, setHp] = useState(''); // honeypot

  useEffect(() => {
    publicForms.get(token)
      .then(r => {
        if (r.data.status === 'closed') { setForm(r.data); setState('closed'); }
        else { setForm(r.data); setState('open'); }
      })
      .catch(() => setState('missing'));
  }, [token]);

  const setAns = (fid, v) => { setAnswers(a => ({ ...a, [fid]: v })); setErrors(e => ({ ...e, [fid]: null })); };
  const toggleCheck = (fid, choice) => {
    const cur = Array.isArray(answers[fid]) ? answers[fid] : [];
    setAns(fid, cur.includes(choice) ? cur.filter(c => c !== choice) : [...cur, choice]);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await publicForms.submit(token, { answers, website: hp });
      setThanks(r.data.thank_you || {});
      setState('done');
      window.scrollTo(0, 0);
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (e.response?.status === 422 && detail?.field_errors) {
        setErrors(detail.field_errors);
      } else if (e.response?.status === 429) {
        alert('Too many attempts — please try again in a few minutes.');
      } else if (e.response?.status === 410) {
        setState('closed');
      } else {
        alert('Something went wrong — please try again.');
      }
    } finally { setSubmitting(false); }
  };

  const Shell = ({ children }) => (
    <div style={{ minHeight: '100vh', background: '#f4f6fb', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ fontWeight: 800, fontSize: 20, color: '#1a1a2e' }}>
            SMART<span style={{ color: ACCENT }}>SHAPE</span>
          </span>
        </div>
        {children}
        <p style={{ textAlign: 'center', color: '#9aa3b2', fontSize: 12, marginTop: 20 }}>
          Powered by SmartShape Pro
        </p>
      </div>
    </div>
  );
  const Card = ({ children }) => (
    <div style={{ background: '#fff', borderRadius: 14, padding: 22,
                  boxShadow: '0 4px 18px rgba(26,26,46,.08)' }}>{children}</div>
  );

  if (state === 'loading') return <Shell><Card><p style={{ color: '#667' }}>Loading…</p></Card></Shell>;
  if (state === 'missing') return <Shell><Card>
    <h2 style={{ margin: 0 }}>Form not found</h2>
    <p style={{ color: '#667' }}>This link is invalid or has been removed.</p>
  </Card></Shell>;
  if (state === 'closed') return <Shell><Card>
    <h2 style={{ margin: 0 }}>{form?.title || 'Registrations closed'}</h2>
    <p style={{ color: '#667' }}>Registrations for this session are closed. Thank you for your interest!</p>
  </Card></Shell>;

  if (state === 'done') return <Shell><Card>
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 44 }}>🎉</div>
      <h2 style={{ color: ACCENT, margin: '8px 0' }}>Registration Confirmed</h2>
      <p style={{ color: '#444' }}>{thanks?.message}</p>
      {thanks?.date && <p style={{ color: '#444', fontWeight: 600 }}>
        {thanks.date}{thanks.time ? ` · ${thanks.time}` : ''}</p>}
      {thanks?.zoom_link && (
        <a href={thanks.zoom_link} style={{ display: 'inline-block', background: ACCENT,
             color: '#fff', padding: '13px 26px', borderRadius: 8, textDecoration: 'none',
             fontWeight: 700, margin: '10px 0' }}>
          JOIN ZOOM MEETING
        </a>)}
      <br />
      {thanks?.calendar_link && (
        <a href={thanks.calendar_link} target="_blank" rel="noreferrer"
           style={{ display: 'inline-block', border: `2px solid ${ACCENT}`, color: ACCENT,
                    padding: '10px 22px', borderRadius: 8, textDecoration: 'none',
                    fontWeight: 700, marginTop: 6 }}>
          📅 Add to Google Calendar
        </a>)}
      <p style={{ color: '#889', fontSize: 13, marginTop: 14 }}>
        The joining details were also sent to your email & WhatsApp.
      </p>
    </div>
  </Card></Shell>;

  const ev = form.event || {};
  const inputStyle = (fid) => ({
    width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15,
    borderRadius: 8, border: `1.5px solid ${errors[fid] ? ACCENT : '#d6dbe6'}`,
    marginTop: 6, background: '#fff', color: '#1a1a2e',
  });

  return (
    <Shell>
      {form.banner_url && (
        <img src={form.banner_url} alt="" style={{ width: '100%', borderRadius: 14, marginBottom: 12 }} />
      )}
      <Card>
        <h1 style={{ fontSize: 22, margin: 0, color: '#1a1a2e' }}>{form.title}</h1>
        {form.description && <p style={{ color: '#556', fontSize: 14 }}>{form.description}</p>}
        {form.type === 'event' && (ev.theme || ev.date) && (
          <div style={{ background: '#f4f6fb', borderRadius: 10, padding: 12, margin: '12px 0',
                        fontSize: 14, color: '#334' }}>
            {ev.theme && <div><b>Theme:</b> {ev.theme}</div>}
            {ev.date && <div><b>Date:</b> {ev.date}</div>}
            {ev.time && <div><b>Time:</b> {ev.time} (IST)</div>}
            <div><b>Platform:</b> {ev.platform === 'zoom' ? 'Zoom (link shared after registration)' : ev.platform}</div>
          </div>
        )}

        {form.fields.map(f => (
          <div key={f.field_id} style={{ marginTop: 14 }}>
            <label style={{ fontWeight: 600, fontSize: 14, color: '#1a1a2e' }}>
              {f.label}{f.required && <span style={{ color: ACCENT }}> *</span>}
            </label>
            {f.type === 'dropdown' ? (
              <select value={answers[f.field_id] || ''} style={inputStyle(f.field_id)}
                      onChange={e => setAns(f.field_id, e.target.value)}>
                <option value="">Select…</option>
                {(f.choices || []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : f.type === 'multiple_choice' ? (
              <div style={{ marginTop: 6 }}>{(f.choices || []).map(c => (
                <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'center',
                                        fontSize: 14, padding: '4px 0', color: '#334' }}>
                  <input type="radio" name={f.field_id} checked={answers[f.field_id] === c}
                         onChange={() => setAns(f.field_id, c)} /> {c}
                </label>))}</div>
            ) : f.type === 'checkbox' ? (
              <div style={{ marginTop: 6 }}>{(f.choices || []).map(c => (
                <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'center',
                                        fontSize: 14, padding: '4px 0', color: '#334' }}>
                  <input type="checkbox"
                         checked={Array.isArray(answers[f.field_id]) && answers[f.field_id].includes(c)}
                         onChange={() => toggleCheck(f.field_id, c)} /> {c}
                </label>))}</div>
            ) : f.type === 'textarea' ? (
              <textarea rows={4} value={answers[f.field_id] || ''} style={inputStyle(f.field_id)}
                        onChange={e => setAns(f.field_id, e.target.value)} />
            ) : (
              <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                     value={answers[f.field_id] || ''} style={inputStyle(f.field_id)}
                     onChange={e => setAns(f.field_id, e.target.value)}
                     inputMode={f.map_to === 'phone' ? 'tel' : undefined} />
            )}
            {errors[f.field_id] && (
              <div style={{ color: ACCENT, fontSize: 12, marginTop: 4 }}>{errors[f.field_id]}</div>
            )}
          </div>
        ))}

        {/* Honeypot — visually hidden from humans, bots fill it */}
        <input type="text" value={hp} onChange={e => setHp(e.target.value)}
               autoComplete="off" tabIndex={-1} aria-hidden="true"
               style={{ position: 'absolute', left: '-5000px', height: 0, width: 0, opacity: 0 }}
               name="website" />

        <button onClick={submit} disabled={submitting}
                style={{ width: '100%', background: ACCENT, color: '#fff', border: 'none',
                         borderRadius: 10, padding: '14px 0', fontSize: 16, fontWeight: 700,
                         marginTop: 20, cursor: 'pointer', opacity: submitting ? .6 : 1 }}>
          {submitting ? 'Registering…' : 'Register'}
        </button>
      </Card>
    </Shell>
  );
}
