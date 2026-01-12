"use client";

import React, { useState, useRef, useEffect } from 'react';

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLPreElement>(null);

  const handleExport = () => {
    setIsLoading(true);
    setError(null);
    setLogs([]);

    const eventSource = new EventSource('/api/export-products');

    eventSource.onopen = () => {
      console.log('Conexão de streaming aberta.');
    };

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'log') {
        setLogs((prevLogs) => [...prevLogs, data.message]);
      } else if (data.type === 'done') {
        setLogs((prevLogs) => [...prevLogs, 'Download iniciado...']);
        downloadCsv(data.csvContent);
        setIsLoading(false);
        eventSource.close();
      } else if (data.type === 'error') {
        setError(data.message);
        setIsLoading(false);
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      setError('Falha na conexão de streaming com o servidor.');
      setIsLoading(false);
      eventSource.close();
    };
  };

  const downloadCsv = (csvContent: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products_hubspot.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Migração Spotter para HubSpot</h1>
      <p>
        Clique no botão abaixo para exportar os produtos do Spotter e gerar um
        arquivo CSV pronto para importação no HubSpot.
      </p>
      <button
        onClick={handleExport}
        disabled={isLoading}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          backgroundColor: isLoading ? '#ccc' : '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
        }}
      >
        {isLoading ? 'Exportando...' : 'Exportar Produtos para CSV'}
      </button>

      {logs.length > 0 && (
        <div style={{ marginTop: '1.5rem', border: '1px solid #ccc', padding: '1rem', borderRadius: '5px', backgroundColor: '#f9f9f9' }}>
          <h2>Logs da Execução</h2>
          <pre ref={logContainerRef} style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', maxHeight: '300px', overflowY: 'auto', margin: 0, fontFamily: 'monospace' }}>
            {logs.join('\n')}
          </pre>
        </div>
      )}

      {error && <p style={{ color: 'red', marginTop: '1rem' }}>Erro: {error}</p>}
    </div>
  );
}
