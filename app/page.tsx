"use client";

import React, { useState, useRef, useEffect } from 'react';

export default function HomePage() {
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [isCompaniesLoading, setIsCompaniesLoading] = useState(false);
  const [isContactsLoading, setIsContactsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLPreElement>(null);

  const startExport = (entity: 'products' | 'companies' | 'contacts') => {
    let isLoading, setIsLoading, apiUrl, fileName;

    switch (entity) {
      case 'products':
        isLoading = isProductsLoading;
        setIsLoading = setIsProductsLoading;
        apiUrl = '/api/export-products';
        fileName = 'products_hubspot.csv';
        break;
      case 'companies':
        isLoading = isCompaniesLoading;
        setIsLoading = setIsCompaniesLoading;
        apiUrl = '/api/export-companies';
        fileName = 'spotter_to_hubspot_empresas.csv';
        break;
      case 'contacts':
        isLoading = isContactsLoading;
        setIsLoading = setIsContactsLoading;
        apiUrl = '/api/export-contacts';
        fileName = 'spotter_to_hubspot_contatos.csv';
        break;
    }

    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setLogs([]); // Clear logs for new export

    const eventSource = new EventSource(apiUrl);

    eventSource.onopen = () => {
      console.log(`Conexão de streaming aberta para ${entity}.`);
      setLogs((prevLogs) => [...prevLogs, `Iniciando exportação de ${entity}...`]);
    };

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'log') {
        setLogs((prevLogs) => [...prevLogs, data.message]);
      } else if (data.type === 'done') {
        setLogs((prevLogs) => [...prevLogs, 'Exportação concluída. Download iniciado...']);
        downloadCsv(data.csvContent, fileName);
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

  const downloadCsv = (csvContent: string, fileName: string) => {
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
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

  const anyExportRunning = isProductsLoading || isCompaniesLoading || isContactsLoading;

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Migração Spotter para HubSpot</h1>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <p>Clique para exportar os produtos do Spotter para um CSV.</p>
          <button
            onClick={() => startExport('products')}
            disabled={anyExportRunning}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              cursor: anyExportRunning ? 'not-allowed' : 'pointer',
              backgroundColor: isProductsLoading ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
            }}
          >
            {isProductsLoading ? 'Exportando Produtos...' : 'Exportar Produtos (CSV)'}
          </button>
        </div>

        <div>
          <p>Clique para exportar as empresas do Spotter para um CSV.</p>
          <button
            onClick={() => startExport('companies')}
            disabled={anyExportRunning}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              cursor: anyExportRunning ? 'not-allowed' : 'pointer',
              backgroundColor: isCompaniesLoading ? '#ccc' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
            }}
          >
            {isCompaniesLoading ? 'Exportando Empresas...' : 'Exportar Empresas (CSV)'}
          </button>
        </div>

        <div>
          <p>Clique para exportar os contatos do Spotter para um CSV.</p>
          <button
            onClick={() => startExport('contacts')}
            disabled={anyExportRunning}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              cursor: anyExportRunning ? 'not-allowed' : 'pointer',
              backgroundColor: isContactsLoading ? '#ccc' : '#17a2b8',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
            }}
          >
            {isContactsLoading ? 'Exportando Contatos...' : 'Exportar Contatos (CSV)'}
          </button>
        </div>
      </div>

      {(logs.length > 0 || anyExportRunning) && (
        <div style={{ marginTop: '1.5rem', border: '1px solid #ccc', padding: '1rem', borderRadius: '5px', backgroundColor: '#f9f9f9' }}>
          <h2>Logs da Execução</h2>
          <pre ref={logContainerRef} style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', maxHeight: '400px', overflowY: 'auto', margin: 0, fontFamily: 'monospace', fontSize: '14px' }}>
            {logs.join('\n')}
          </pre>
        </div>
      )}

      {error && <p style={{ color: 'red', marginTop: '1rem' }}><strong>Erro:</strong> {error}</p>}
    </div>
  );
}
