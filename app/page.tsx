"use client";

import React, { useState, useEffect } from 'react';

type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items' | 'losts';

interface JobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'error';
  step?: string;
  page?: number;
  totalItems?: number;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
}

interface BackupFile {
  path: string;
  size: number;
  updatedAt: string;
}

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [activeExport, setActiveExport] = useState<ExportableEntity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  // Backup Total State
  const [backupJobId, setBackupJobId] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<JobStatus | null>(null);
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([]);
  const [isBackupLoading, setIsBackupLoading] = useState(false);

  // Poll for logs if we have a runId (Legacy Export)
  useEffect(() => {
      let interval: NodeJS.Timeout;
      if (currentRunId) {
          fetchLogs(currentRunId);
          interval = setInterval(() => fetchLogs(currentRunId), 2000);
      }
      return () => clearInterval(interval);
  }, [currentRunId]);

  // Poll for Backup Status
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (backupJobId && backupStatus?.status !== 'done' && backupStatus?.status !== 'error') {
      const checkStatus = async () => {
        try {
          const res = await fetch(`/api/backup-total/status?jobId=${backupJobId}`);
          if (res.ok) {
            const data = await res.json();
            setBackupStatus(data);
            if (data.status === 'done') {
               loadBackupFiles(backupJobId);
               setIsBackupLoading(false);
            }
            if (data.status === 'error') {
               setIsBackupLoading(false);
            }
          }
        } catch (e) {
          console.error("Status check failed", e);
        }
      };

      checkStatus();
      interval = setInterval(checkStatus, 2000);
    }
    return () => clearInterval(interval);
  }, [backupJobId, backupStatus?.status]);

  const loadBackupFiles = async (jobId: string) => {
      try {
          const res = await fetch(`/api/backup-total/files?jobId=${jobId}`);
          if (res.ok) {
              const data = await res.json();
              setBackupFiles(data.files || []);
          }
      } catch (e) {
          console.error("Failed to load files", e);
      }
  };

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

  const startBackupTotal = async () => {
    if (isBackupLoading) return;
    setIsBackupLoading(true);
    setBackupJobId(null);
    setBackupStatus(null);
    setBackupFiles([]);

    try {
        const res = await fetch('/api/backup-total/start', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to start backup');
        const data = await res.json();
        setBackupJobId(data.jobId);
        setBackupStatus({ jobId: data.jobId, status: 'queued', startedAt: new Date().toISOString() });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        alert(msg);
        setIsBackupLoading(false);
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
        <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>1. Exportar CSV</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={() => startExport('companies')} disabled={isLoading} style={buttonStyle(isLoading && activeExport !== 'companies')}>Empresas</button>
          <button onClick={() => startExport('contacts')} disabled={isLoading} style={buttonStyle(isLoading && activeExport !== 'contacts')}>Contatos</button>
          <button onClick={() => startExport('deals_line_items')} disabled={isLoading} style={{ ...buttonStyle(isLoading && activeExport !== 'deals_line_items'), backgroundColor: '#005bb5' }}>Negócios + Itens</button>
          <button onClick={() => startExport('losts')} disabled={isLoading} style={{ ...buttonStyle(isLoading && activeExport !== 'losts'), backgroundColor: '#d93025' }}>Descartados (Losts)</button>
        </div>
        {isLoading && <p style={{ marginTop: '1rem', color: '#666' }}>Processando... Isso pode levar alguns minutos.</p>}
        {error && (
            <div style={{ color: 'red', marginTop: '1rem', border: '1px solid red', padding: '1rem', borderRadius: '5px', backgroundColor: '#ffebee' }}>
            <strong>Erro:</strong> {error}
            </div>
        )}
      </div>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#fff', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem', margin: '0 0 1rem 0' }}>2. Auditoria e Logs (Exportação Individual)</h2>
          <div style={{ backgroundColor: '#f4f4f4', padding: '1rem', borderRadius: '5px', maxHeight: '300px', overflowY: 'auto' }}>
              {logs.length === 0 ? <p style={{ color: '#777', margin: 0 }}>Nenhum log disponível.</p> : (
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', fontFamily: 'monospace', margin: 0, color: '#333' }}>{logs.join('\n')}</pre>
              )}
          </div>
      </div>

      {/* --- New Backup Total UI --- */}
      <div style={{ border: '1px solid #333', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#eef', marginTop: '2rem' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', color: '#333' }}>3. Admin / Backup Total (No-ZIP)</h2>
          <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#555' }}>
              Gera todos os arquivos no servidor e permite download individual. Evita corrupção de arquivos grandes.
          </p>

          {!backupJobId && (
              <button
                onClick={startBackupTotal}
                disabled={isBackupLoading}
                style={{ ...buttonStyle(isBackupLoading), backgroundColor: '#333', border: '1px solid #000' }}
              >
                {isBackupLoading ? 'Iniciando...' : 'Iniciar Backup Total'}
              </button>
          )}

          {backupStatus && (
              <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#fff', borderRadius: '5px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <strong>Status: {backupStatus.status.toUpperCase()}</strong>
                      <span>Job ID: {backupStatus.jobId.slice(0, 8)}...</span>
                  </div>

                  {backupStatus.status === 'running' && (
                      <div style={{ color: '#0070f3' }}>
                          <p>Etapa atual: <strong>{backupStatus.step}</strong></p>
                          <p>Página: {backupStatus.page || 0} | Itens processados: {backupStatus.totalItems || 0}</p>
                          <small>Atualizando automaticamente...</small>
                      </div>
                  )}

                  {backupStatus.status === 'error' && (
                      <div style={{ color: 'red' }}>
                          <p>Erro: {backupStatus.errorMessage}</p>
                          <button onClick={startBackupTotal} style={{ marginTop: '0.5rem', padding: '5px 10px' }}>Tentar Novamente</button>
                      </div>
                  )}

                  {backupStatus.status === 'done' && (
                      <div>
                          <p style={{ color: 'green', marginBottom: '1rem' }}>Backup concluído com sucesso!</p>
                          <h4 style={{ margin: '0.5rem 0' }}>Arquivos Gerados:</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', maxHeight: '400px', overflowY: 'auto' }}>
                              {backupFiles.map((f) => (
                                  <React.Fragment key={f.path}>
                                      <span style={{ fontSize: '0.9rem', fontFamily: 'monospace' }}>{f.path}</span>
                                      <a
                                        href={`/api/backup-total/download?jobId=${backupJobId}&path=${f.path}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: '#0070f3', textDecoration: 'none', fontWeight: 'bold' }}
                                      >
                                          [Baixar {(f.size / 1024).toFixed(1)} KB]
                                      </a>
                                  </React.Fragment>
                              ))}
                          </div>
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
