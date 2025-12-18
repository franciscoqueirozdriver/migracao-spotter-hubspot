"use client";

import React, { useState, useRef, useEffect } from 'react';

type ExportMode = 'sold' | 'open' | 'lost' | 'custom';

const modeConfig = {
  sold: {
    label: 'Vendas concluídas',
    description: 'Empresas, Contatos, Negócios e Itens de Linha de vendas a partir do endpoint LeadsSold.',
    entities: ['Empresas', 'Contatos', 'Negócios', 'Itens de Linha'],
  },
  open: {
    label: 'Leads em andamento',
    description: 'Empresas, Contatos e Negócios (sem itens de linha) com stage != Vendido e != Perdido.',
    entities: ['Empresas', 'Contatos', 'Negócios'],
  },
  lost: {
    label: 'Leads perdidos',
    description: 'Empresas, Contatos e Negócios com stage == Perdido.',
    entities: ['Empresas', 'Contatos', 'Negócios'],
  },
  custom: {
    label: 'Personalizado (avançado)',
    description: 'Permite selecionar endpoints e filtros manualmente. CUIDADO: pode gerar dados inconsistentes.',
    entities: ['N/A'],
  },
};

export default function HomePage() {
  const [selectedMode, setSelectedMode] = useState<ExportMode>('sold');
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLPreElement>(null);

  const startExport = () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setLogs([]); // Clear logs for new export

    const apiUrl = `/api/export?mode=${selectedMode}`;
    const eventSource = new EventSource(apiUrl);

    eventSource.onopen = () => {
      setLogs(prevLogs => [...prevLogs, `Conexão estabelecida. Iniciando exportação no modo: ${selectedMode}...`]);
    };

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'log') {
        setLogs(prevLogs => [...prevLogs, data.message]);
      } else if (data.type === 'done') {
        setLogs(prevLogs => [...prevLogs, 'Exportação principal concluída. Iniciando download do CSV principal...']);

        const fileName = `hubspot_export_${selectedMode}_${new Date().toISOString().split('T')[0]}.csv`;
        downloadCsv(data.csvContent, fileName);

        if (data.exportId) {
            setLogs(prevLogs => [...prevLogs, `ID da execução: ${data.exportId}. Arquivos de log e de registros inválidos (se houver) foram salvos no servidor.`]);
            // In a real scenario, you might offer a download link for the invalid CSV
            // For now, we just log that it was created on the server.
        }

        setIsLoading(false);
        eventSource.close();
      } else if (data.type === 'error') {
        setError(data.message);
        setIsLoading(false);
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      setError('Falha na conexão de streaming com o servidor. A exportação pode ter falhado.');
      setIsLoading(false);
      eventSource.close();
    };
  };

  const downloadCsv = (csvContent: string, fileName: string) => {
    if (!csvContent) {
        setLogs(prevLogs => [...prevLogs, 'AVISO: O CSV principal está vazio. Nenhum arquivo para baixar.']);
        return;
    }
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    setLogs(prevLogs => [...prevLogs, `Download do arquivo "${fileName}" iniciado.`]);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const currentConfig = modeConfig[selectedMode];

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Migração Spotter para HubSpot</h1>
      <p>Um assistente para gerar arquivos CSV compatíveis com o importador do HubSpot a partir da API da Exact Spotter.</p>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#f9f9f9' }}>

        {/* 1. Dropdown obrigatório */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="import-mode" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            O que você deseja importar?
          </label>
          <select
            id="import-mode"
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value as ExportMode)}
            disabled={isLoading}
            style={{ width: '100%', padding: '10px', fontSize: '16px', borderRadius: '5px', border: '1px solid #ccc' }}
          >
            <option value="sold">Vendas concluídas</option>
            <option value="open">Leads em andamento</option>
            <option value="lost">Leads perdidos</option>
            <option value="custom" disabled>Personalizado (avançado) - Em breve</option>
          </select>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '0.5rem' }}>{currentConfig.description}</p>
        </div>

        {/* 2. Checkboxes de objetos (somente leitura) */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>Objetos a serem exportados neste modo:</h3>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {currentConfig.entities.map(entity => (
              <div key={entity} style={{ display: 'flex', alignItems: 'center' }}>
                <input type="checkbox" checked readOnly style={{ marginRight: '0.5rem', accentColor: '#007bff' }} />
                <span>{entity}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Botão de exportação */}
        <button
          onClick={startExport}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '12px 20px',
            fontSize: '18px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            backgroundColor: isLoading ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            fontWeight: 'bold',
          }}
        >
          {isLoading ? 'Exportando...' : `Gerar CSV (${currentConfig.label})`}
        </button>
      </div>

      {(logs.length > 0 || isLoading) && (
        <div style={{ marginTop: '1.5rem', border: '1px solid #ccc', padding: '1rem', borderRadius: '5px', backgroundColor: '#fff' }}>
          <h2>Logs da Execução</h2>
          <pre ref={logContainerRef} style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', maxHeight: '400px', overflowY: 'auto', margin: 0, fontFamily: 'monospace', fontSize: '14px', backgroundColor: '#f5f5f5', padding: '1rem', borderRadius: '5px' }}>
            {logs.join('\n')}
          </pre>
        </div>
      )}

      {error && <p style={{ color: 'red', marginTop: '1rem', fontWeight: 'bold', backgroundColor: '#ffebee', border: '1px solid #e57373', padding: '1rem', borderRadius: '5px' }}><strong>Erro:</strong> {error}</p>}
    </div>
  );
}
