import { useEffect, useState } from 'react'

export function toast(message, type = 'info', timeout = 2500) {
  window.dispatchEvent(new CustomEvent('toast:show', { detail: { message, type, timeout } }));
}

export default function ToastHost() {
  const [list, setList] = useState([]);

  useEffect(() => {
    const onShow = e => {
      const id = Date.now() + Math.random();
      const t = { id, ...e.detail };
      setList(prev => [...prev, t]);
      setTimeout(() => {
        setList(prev => prev.filter(x => x.id !== id));
      }, t.timeout || 2500);
    };
    window.addEventListener('toast:show', onShow);
    return () => window.removeEventListener('toast:show', onShow);
  }, []);

  const base = {
    position:'fixed', right:'16px', bottom:'16px', zIndex:2000,
    display:'flex', flexDirection:'column', gap:'8px'
  };
  const item = (type) => ({
    background:'#fff', border:'1px solid #eee', borderLeft:`4px solid ${type==='error'?'#c33': type==='success'?'#2a7':'#888'}`,
    borderRadius:'8px', padding:'10px 12px', boxShadow:'0 8px 16px rgba(0,0,0,.08)', minWidth:'240px'
  });

  return (
    <div style={base}>
      {list.map(t => (
        <div key={t.id} style={item(t.type)}>{t.message}</div>
      ))}
    </div>
  );
}