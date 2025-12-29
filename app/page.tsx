"use client";

import React, { useState, useEffect } from 'react';

type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items' | 'losts';

// Simplified configuration for UI
const BACKUP_ENTITIES = [
  { group: 'Core', items: [
      { key: 'leads', name: 'Leads (Oportunidades)' },
      { key: 'companies', name: 'Empresas' },
      { key: 'contacts', name: 'Contatos' },
      { key: 'users', name: 'Usuários' },
      { key: 'sellers', name: 'Vendedores' },
      { key: 'groups', name: 'Grupos/Times' }
  ]},
  { group: 'Events', items: [
      { key: 'losts', name: 'Descartados (Losts)' },
      { key: 'history', name: 'Histórico de Transferências' },
      { key: 'meetings', name: 'Reuniões' }
  ]},
  { group: 'Dictionaries', items: [
      { key: 'funnels', name: 'Funis' },
      { key: 'stages', name: 'Etapas' },
      { key: 'sources', name: 'Origens' },
      { key: 'discard_reasons', name: 'Motivos de Descarte' },
      { key: 'products', name: 'Produtos' },
      { key: 'tasks_type', name: 'Tipos de Tarefa' },
      { key: 'custom_fields_leads', name: 'Campos Custom (Leads)' },
      { key: 'custom_fields_orgs', name: 'Campos Custom (Empresas)' }
  ]}
];

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [activeExport, setActiveExport] = useState<ExportableEntity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  // Poll for logs if we have a runId (Legacy Export)
  useEffect(() => {
      let interval: NodeJS.Timeout;
      if (currentRunId) {
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

  const startLegacyExport = async (entity: ExportableEntity) => {
    if (isLoading) return;

    setIsLoading(true);
    setActiveExport(entity);
    setError(null);
    setLogs([]);
    setCurrentRunId(null);

    try {
      const response = await fetch(`/api/export?mode=total&entity=${entity}`);
      const runId = response.headers.get('X-Export-Run-Id');
      if (runId) setCurrentRunId(runId);

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

      downloadBlob(blob, fileName);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.';
      setError(msg);
      setLogs(prev => [...prev, `[CLIENT ERROR] ${msg}`]);
    } finally {
      setIsLoading(false);
      setActiveExport(null);
    }
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '900px', margin: 'auto' }}>
      <h1>Migração Spotter → HubSpot</h1>
      <p>Exportação de dados (Modo Total - Auditoria Completa)</p>

      {/* --- Legacy Exports --- */}
      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#f9f9f9', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>1. Exportar CSV (Curadoria)</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={() => startLegacyExport('companies')} disabled={isLoading} style={buttonStyle(isLoading && activeExport !== 'companies')}>Empresas</button>
          <button onClick={() => startLegacyExport('contacts')} disabled={isLoading} style={buttonStyle(isLoading && activeExport !== 'contacts')}>Contatos</button>
          <button onClick={() => startLegacyExport('deals_line_items')} disabled={isLoading} style={{ ...buttonStyle(isLoading && activeExport !== 'deals_line_items'), backgroundColor: '#005bb5' }}>Negócios + Itens</button>
          <button onClick={() => startLegacyExport('losts')} disabled={isLoading} style={{ ...buttonStyle(isLoading && activeExport !== 'losts'), backgroundColor: '#d93025' }}>Descartados (Losts)</button>
        </div>
        {isLoading && <p style={{ marginTop: '1rem', color: '#666' }}>Processando... Isso pode levar alguns minutos.</p>}
        {error && (
            <div style={{ color: 'red', marginTop: '1rem', border: '1px solid red', padding: '1rem', borderRadius: '5px', backgroundColor: '#ffebee' }}>
            <strong>Erro:</strong> {error}
            </div>
        )}
      </div>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#fff', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem', margin: '0 0 1rem 0' }}>2. Auditoria e Logs (Curadoria)</h2>
          <div style={{ backgroundColor: '#f4f4f4', padding: '1rem', borderRadius: '5px', maxHeight: '300px', overflowY: 'auto' }}>
              {logs.length === 0 ? <p style={{ color: '#777', margin: 0 }}>Nenhum log disponível.</p> : (
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', fontFamily: 'monospace', margin: 0, color: '#333' }}>{logs.join('\n')}</pre>
              )}
          </div>
      </div>

      {/* --- Backup Total UI (Sync Download) --- */}
      <div style={{ border: '1px solid #333', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#eef', marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', color: '#333' }}>3. Admin / Backup Total (No-ZIP)</h2>
          <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#555' }}>
              Download direto de arquivos brutos da API. Paginação completa.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
              {BACKUP_ENTITIES.map(group => (
                  <div key={group.group} style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '5px' }}>
                      <strong style={{ display: 'block', marginBottom: '0.5rem', color: '#005bb5' }}>{group.group}</strong>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {group.items.map(item => (
                              <a
                                key={item.key}
                                href={`/api/backup-total/export?entity=${item.key}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={downloadLinkStyle}
                              >
                                  ⬇ {item.name}
                              </a>
                          ))}
                      </div>
                  </div>
              ))}
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

const downloadLinkStyle: React.CSSProperties = {
    textDecoration: 'none',
    color: '#333',
    fontSize: '0.9rem',
    padding: '4px 8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    backgroundColor: '#f9f9f9',
    display: 'block',
    textAlign: 'center'
};
