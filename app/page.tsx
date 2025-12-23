"use client";

import React, { useState, useEffect } from 'react';

type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [activeExport, setActiveExport] = useState<ExportableEntity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  // Poll for logs if we have a runId
  useEffect(() => {
      let interval: NodeJS.Timeout;
      if (currentRunId) {
          // Initial fetch
          fetchLogs(currentRunId);
          interval = setInterval(() => fetchLogs(currentRunId), 2000);
      }
      return () => clearInterval(interval);
  }, [currentRunId]);

  const fetchLogs = async (runId: string) => {
      try {
          const res = await fetch(`/api/export/logs?runId=${runId}`);
          if (res.ok) {
              const data = await res.json();
              setLogs(data.lines || []);
          }
      } catch (e) {
          console.error('Log fetch error:', e);
      }
  };

  const startExport = async (entity: ExportableEntity) => {
    if (isLoading) return;

    setIsLoading(true);
    setActiveExport(entity);
    setError(null);
    setLogs([]);
    setCurrentRunId(null);

    try {
      const response = await fetch(`/api/export?mode=total&entity=${entity}`);

      // Get Run ID immediately to start logging even if download takes time
      const runId = response.headers.get('X-Export-Run-Id');
      if (runId) {
          setCurrentRunId(runId);
      }

      if (!response.ok) {
        let errorMsg = `Erro ${response.status}`;
        try {
            const data = await response.json();
            errorMsg = data.message || errorMsg;
        } catch (e) { }
        throw new Error(errorMsg);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition');
      let fileName = `${entity}.csv`;
      if (disposition && disposition.includes('filename=')) {
          const match = disposition.match(/filename="?([^"]+)"?/);
          if (match && match[1]) fileName = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.';
      setError(msg);
      // If we have a runId, the logs might contain the server-side error detail,
      // but let's append client side error too if possible or just rely on state.
      setLogs(prev => [...prev, `[CLIENT ERROR] ${msg}`]);
    } finally {
      setIsLoading(false);
      setActiveExport(null);
      // Stop polling after a while? Or keep it?
      // Requirement says: "Após o download disparar, a caixa de logs é preenchida automaticamente".
      // We leave polling active for a bit or rely on user to see "Finished".
      // Let's keep polling active as long as the component is mounted or until a new run starts.
      // But we might want to stop interval eventually. For simplicity, we just keep currentRunId set.
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '900px', margin: 'auto' }}>
      <h1>Migração Spotter → HubSpot</h1>
      <p>Exportação de dados (Modo Total - Auditoria Completa)</p>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#f9f9f9', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>1. Exportar CSV</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => startExport('companies')}
            disabled={isLoading}
            style={buttonStyle(isLoading && activeExport !== 'companies')}
          >
            {activeExport === 'companies' ? 'Exportando...' : 'Exportar Empresas'}
          </button>

          <button
            onClick={() => startExport('contacts')}
            disabled={isLoading}
            style={buttonStyle(isLoading && activeExport !== 'contacts')}
          >
            {activeExport === 'contacts' ? 'Exportando...' : 'Exportar Contatos'}
          </button>

          <button
            onClick={() => startExport('deals_line_items')}
            disabled={isLoading}
            style={{ ...buttonStyle(isLoading && activeExport !== 'deals_line_items'), backgroundColor: '#005bb5' }}
          >
            {activeExport === 'deals_line_items' ? 'Exportando...' : 'Exportar Negócios + Itens de Linha'}
          </button>
        </div>
        {isLoading && <p style={{ marginTop: '1rem', color: '#666' }}>Processando... Isso pode levar alguns minutos.</p>}
        {error && (
            <div style={{ color: 'red', marginTop: '1rem', border: '1px solid red', padding: '1rem', borderRadius: '5px', backgroundColor: '#ffebee' }}>
            <strong>Erro:</strong> {error}
            </div>
        )}
      </div>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#fff' }}>
          <h2 style={{ fontSize: '1.2rem', margin: '0 0 1rem 0' }}>2. Auditoria e Logs</h2>

          <div style={{ backgroundColor: '#f4f4f4', padding: '1rem', borderRadius: '5px', maxHeight: '500px', overflowY: 'auto' }}>
              {logs.length === 0 ? (
                  <p style={{ color: '#777', margin: 0 }}>Nenhum log disponível.</p>
              ) : (
                  <pre style={{
                      whiteSpace: 'pre-wrap',
                      fontSize: '0.85rem',
                      fontFamily: 'monospace',
                      margin: 0,
                      color: '#333'
                  }}>
                      {logs.join('\n')}
                  </pre>
              )}
          </div>
      </div>
    </div>
  );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
    return {
        padding: '12px 20px',
        fontSize: '16px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: disabled ? '#eee' : '#0070f3',
        color: disabled ? '#999' : 'white',
        border: 'none',
        borderRadius: '5px',
        fontWeight: 'bold',
        opacity: disabled ? 0.6 : 1
    };
}
