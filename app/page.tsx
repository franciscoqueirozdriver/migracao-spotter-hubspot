"use client";

import React, { useState, useRef, useEffect } from 'react';

type ExportMode = 'sold' | 'open' | 'lost';
type ExportEntity = 'companies' | 'contacts' | 'deals' | 'lineItems';

const modeConfig: Record<ExportMode, { label: string; description: string; entities: ExportEntity[] }> = {
  sold: {
    label: 'Vendas concluídas',
    description: 'Exporte Empresas, Contatos, Negócios e/ou Itens de Linha baseados em vendas já realizadas.',
    entities: ['companies', 'contacts', 'deals', 'lineItems'],
  },
  open: {
    label: 'Leads em andamento',
    description: 'Exporte Empresas, Contatos e Negócios que ainda estão no pipeline de vendas.',
    entities: ['companies', 'contacts', 'deals'],
  },
  lost: {
    label: 'Leads perdidos',
    description: 'Exporte Empresas, Contatos e Negócios que foram marcados como perdidos.',
    entities: ['companies', 'contacts', 'deals'],
  },
};

const entityLabels: Record<ExportEntity, string> = {
    companies: 'Empresas',
    contacts: 'Contatos',
    deals: 'Negócios',
    lineItems: 'Itens de Linha',
};

export default function HomePage() {
  const [selectedMode, setSelectedMode] = useState<ExportMode>('sold');
  const [selectedEntities, setSelectedEntities] = useState<Record<ExportEntity, boolean>>({
    companies: true,
    contacts: true,
    deals: true,
    lineItems: true,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLPreElement>(null);

  const handleEntityChange = (entity: ExportEntity) => {
    const newSelection = { ...selectedEntities, [entity]: !selectedEntities[entity] };

    // Rule: Selecting lineItems auto-selects deals
    if (entity === 'lineItems' && newSelection.lineItems) {
      if (!newSelection.deals) {
          newSelection.deals = true;
          setLogs(prev => [...prev, "AVISO: 'Negócios' foi selecionado automaticamente pois é um pré-requisito para 'Itens de Linha'."]);
      }
    }

    // Rule: Deselecting deals also deselects lineItems
    if (entity === 'deals' && !newSelection.deals) {
        if (newSelection.lineItems) {
            newSelection.lineItems = false;
        }
    }

    setSelectedEntities(newSelection);
  };

  const startExport = () => {
    const entitiesToExport = Object.entries(selectedEntities)
      .filter(([_, isSelected]) => isSelected)
      .map(([entity]) => entity);

    if (entitiesToExport.length === 0) {
      setError('Selecione pelo menos um objeto para exportar.');
      return;
    }

    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setLogs([]);

    const apiUrl = `/api/export?mode=${selectedMode}&export=${entitiesToExport.join(',')}`;
    const eventSource = new EventSource(apiUrl);

    eventSource.onopen = () => {
      setLogs(prev => [...prev, `Conexão estabelecida. Iniciando exportação...`]);
    };

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'log') {
        setLogs(prev => [...prev, data.message]);
      } else if (data.type === 'done') {
        setLogs(prev => [...prev, 'Processamento no servidor concluído.']);
        eventSource.close();
        setIsLoading(false);

        if (data.exportId) {
            setLogs(prev => [...prev, `ID da execução: ${data.exportId}. Iniciando download...`]);
            // Trigger download from the new endpoint
            window.location.href = `/api/download/${data.exportId}`;
        } else {
            setError("Exportação concluída, mas nenhum ID de exportação foi retornado.");
        }
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

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const currentConfig = modeConfig[selectedMode];
  const isAnythingSelected = Object.values(selectedEntities).some(Boolean);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Migração Spotter para HubSpot</h1>
      <p>Um assistente para gerar arquivos CSV compatíveis com o importador do HubSpot a partir da API da Exact Spotter.</p>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#f9f9f9' }}>

        <div style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="import-mode" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            1. Selecione o Cenário de Importação
          </label>
          <select
            id="import-mode"
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value as ExportMode)}
            disabled={isLoading}
            style={{ width: '100%', padding: '10px', fontSize: '16px', borderRadius: '5px', border: '1px solid #ccc' }}
          >
            <option value="sold">Vendas concluídas</option>
            <option value="open" disabled>Leads em andamento (Em breve)</option>
            <option value="lost" disabled>Leads perdidos (Em breve)</option>
          </select>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '0.5rem' }}>{currentConfig.description}</p>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>2. Selecione os Objetos para Exportar</h3>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {currentConfig.entities.map(entity => (
              <div key={entity} style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  id={`checkbox-${entity}`}
                  checked={selectedEntities[entity]}
                  onChange={() => handleEntityChange(entity)}
                  disabled={isLoading}
                  style={{ marginRight: '0.5rem', height: '18px', width: '18px' }}
                />
                <label htmlFor={`checkbox-${entity}`}>{entityLabels[entity]}</label>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={startExport}
          disabled={isLoading || !isAnythingSelected}
          style={{
            width: '100%',
            padding: '12px 20px',
            fontSize: '18px',
            cursor: (isLoading || !isAnythingSelected) ? 'not-allowed' : 'pointer',
            backgroundColor: (isLoading || !isAnythingSelected) ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            fontWeight: 'bold',
          }}
        >
          {isLoading ? 'Exportando...' : `Gerar Arquivo(s) CSV`}
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

      {error && <p style={{ color: 'red', marginTop: '1rem', fontWeight: 'bold' }}><strong>Erro:</strong> {error}</p>}
    </div>
  );
}
