"use client";

import React, { useState } from 'react';

type ExportMode = 'total';
type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';

interface ExportLog {
  startedAt: string;
  finishedAt?: string;
  entity: string;
  modeRequested: string;
  modeApplied: string;
  totals: {
    leadsFetched?: number;
    soldFetched?: number;
    lostFetched?: number;
    dealsGenerated?: number;
    lineItemsGenerated?: number;
    recordsFetched?: number;
    recordsGenerated?: number;
  };
  discards: {
    leadsWithoutOrg?: number;
    leadsWithoutPerson?: number;
  };
  warnings: string[];
  errors: string[];
}

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [activeExport, setActiveExport] = useState<ExportableEntity | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Log state
  const [logs, setLogs] = useState<ExportLog | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const startExport = async (entity: ExportableEntity) => {
    if (isLoading) return;

    setIsLoading(true);
    setActiveExport(entity);
    setError(null);

    try {
      const apiUrl = `/api/export?mode=total&entity=${entity}`;
      const response = await fetch(apiUrl);

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

      // Auto-refresh logs after success
      fetchLogs();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.');
    } finally {
      setIsLoading(false);
      setActiveExport(null);
    }
  };

  const fetchLogs = async () => {
      setLoadingLogs(true);
      try {
          const res = await fetch('/api/export/logs');
          if (res.ok) {
              const data = await res.json();
              setLogs(data);
          } else {
             if (res.status === 404) setLogs(null);
          }
      } catch (e) {
          console.error('Failed to fetch logs', e);
      } finally {
          setLoadingLogs(false);
      }
  };

  const copyLogs = () => {
      if (!logs) return;
      const text = JSON.stringify(logs, null, 2);
      navigator.clipboard.writeText(text).then(() => {
          alert("Logs copiados para a área de transferência!");
      }).catch(err => {
          console.error('Falha ao copiar:', err);
      });
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '900px', margin: 'auto' }}>
      <h1>Migração Spotter → HubSpot</h1>
      <p>Exportação de dados (Modo Total - Auditoria Completa)</p>

      {/* SEÇÃO 1 - EXPORTAÇÃO */}
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

      {/* SEÇÃO 2 - LOGS */}
      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>2. Auditoria e Logs</h2>
            <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={fetchLogs} disabled={loadingLogs} style={{ padding: '8px 16px', cursor: 'pointer' }}>
                    {loadingLogs ? 'Atualizando...' : 'Atualizar Logs'}
                </button>
                {logs && (
                    <button onClick={copyLogs} style={{ padding: '8px 16px', cursor: 'pointer' }}>
                        Copiar JSON
                    </button>
                )}
            </div>
          </div>

          {!logs ? (
              <p style={{ color: '#777' }}>Nenhum log disponível. Execute uma exportação para gerar logs.</p>
          ) : (
              <div style={{ backgroundColor: '#f4f4f4', padding: '1rem', borderRadius: '5px', fontSize: '0.9rem', overflowX: 'auto', maxHeight: '500px' }}>
                  <div style={{ marginBottom: '0.5rem' }}><strong>Entidade:</strong> {logs.entity}</div>
                  <div style={{ marginBottom: '0.5rem' }}><strong>Início:</strong> {new Date(logs.startedAt).toLocaleString()}</div>
                  <div style={{ marginBottom: '0.5rem' }}><strong>Fim:</strong> {logs.finishedAt ? new Date(logs.finishedAt).toLocaleString() : 'Em andamento...'}</div>

                  <div style={{ marginTop: '1rem', borderTop: '1px solid #ddd', paddingTop: '0.5rem' }}>
                      <strong>Totais:</strong>
                      <pre style={{ margin: 0 }}>{JSON.stringify(logs.totals, null, 2)}</pre>
                  </div>

                  {logs.discards && Object.keys(logs.discards).length > 0 && (
                      <div style={{ marginTop: '1rem', borderTop: '1px solid #ddd', paddingTop: '0.5rem' }}>
                        <strong>Descartes:</strong>
                        <pre style={{ margin: 0, color: '#d32f2f' }}>{JSON.stringify(logs.discards, null, 2)}</pre>
                      </div>
                  )}

                  {logs.warnings && logs.warnings.length > 0 && (
                      <div style={{ marginTop: '1rem', borderTop: '1px solid #ddd', paddingTop: '0.5rem', color: '#f57c00' }}>
                          <strong>Avisos ({logs.warnings.length}):</strong>
                          <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                              {logs.warnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                      </div>
                  )}

                  {logs.errors && logs.errors.length > 0 && (
                      <div style={{ marginTop: '1rem', borderTop: '1px solid #ddd', paddingTop: '0.5rem', color: 'red' }}>
                          <strong>Erros:</strong>
                          <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                              {logs.errors.map((e, i) => <li key={i}>{e}</li>)}
                          </ul>
                      </div>
                  )}
              </div>
          )}
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
