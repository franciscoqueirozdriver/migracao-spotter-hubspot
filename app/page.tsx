"use client";

import React, { useState, useRef, useEffect } from 'react';

type ExportMode = 'sold';
type ExportEntity = 'companies' | 'contacts' | 'deals_line_items';
type FunnelId = '22783' | '20676';

const entityLabels: Record<ExportEntity, string> = {
    companies: 'Empresas',
    contacts: 'Contatos',
    deals_line_items: 'Negócios + Itens de Linha',
};

const funnelLabels: Record<FunnelId, string> = {
    '22783': 'Venda (22783)',
    '20676': 'Pré-venda (20676)',
};

export default function HomePage() {
  const [selectedEntities, setSelectedEntities] = useState<Record<ExportEntity, boolean>>({
    companies: true,
    contacts: false,
    deals_line_items: false,
  });
  const [selectedFunnel, setSelectedFunnel] = useState<FunnelId>('22783');
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLPreElement>(null);

  const handleEntityChange = (entity: ExportEntity) => {
    setSelectedEntities(prev => ({ ...prev, [entity]: !prev[entity] }));
  };

  const startExport = () => {
    const entitiesToExport = Object.entries(selectedEntities)
      .filter(([_, isSelected]) => isSelected)
      .map(([entity]) => entity as ExportEntity);

    if (entitiesToExport.length === 0) {
      setError('Selecione pelo menos um arquivo para gerar.');
      return;
    }

    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setLogs([]);

    const apiUrl = `/api/export?mode=sold&export=${entitiesToExport.join(',')}&funnelId=${selectedFunnel}`;
    const eventSource = new EventSource(apiUrl);

    eventSource.onopen = () => setLogs(prev => [...prev, `Conexão estabelecida. Iniciando exportação...`]);

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
            window.location.href = `/api/download/${data.exportId}`;
        } else {
            setLogs(prev => [...prev, "Nenhum arquivo válido foi gerado. Download não iniciado."]);
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
    logContainerRef.current?.scrollTo(0, logContainerRef.current.scrollHeight);
  }, [logs]);

  const isAnythingSelected = Object.values(selectedEntities).some(Boolean);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Migração Spotter → HubSpot</h1>
      <p>Exporte dados do Spotter para arquivos CSV prontos para importação no HubSpot, com cabeçalhos exatos.</p>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#f9f9f9' }}>

        <div style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="funnel-selector" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            1. Selecione o Funil (Modo: Vendas Concluídas)
          </label>
          <select id="funnel-selector" value={selectedFunnel} onChange={(e) => setSelectedFunnel(e.target.value as FunnelId)} disabled={isLoading} style={{ width: '100%', padding: '10px', fontSize: '16px', borderRadius: '5px', border: '1px solid #ccc' }}>
            {Object.keys(funnelLabels).map(funnelId => (
              <option key={funnelId} value={funnelId}>{funnelLabels[funnelId as FunnelId]}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>2. Selecione os Arquivos para Gerar</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            {Object.keys(entityLabels).map(entityStr => {
              const entity = entityStr as ExportEntity;
              return (
                <div key={entity} style={{ display: 'flex', alignItems: 'center' }}>
                  <input type="checkbox" id={`checkbox-${entity}`} checked={selectedEntities[entity]} onChange={() => handleEntityChange(entity)} disabled={isLoading} style={{ marginRight: '0.5rem', height: '18px', width: '18px' }} />
                  <label htmlFor={`checkbox-${entity}`}>{entityLabels[entity]}</label>
                </div>
              );
            })}
          </div>
        </div>

        <button onClick={startExport} disabled={isLoading || !isAnythingSelected} style={{ width: '100%', padding: '12px 20px', fontSize: '18px', cursor: (isLoading || !isAnythingSelected) ? 'not-allowed' : 'pointer', backgroundColor: (isLoading || !isAnythingSelected) ? '#ccc' : '#28a745', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold' }}>
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
