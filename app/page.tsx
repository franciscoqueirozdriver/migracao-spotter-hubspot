"use client";

import React, { useState, useEffect } from 'react';

type ExportMode = 'sold' | 'inProgress' | 'lost';
type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';

const entityConfig: Record<ExportableEntity, { label: string }> = {
  companies: { label: 'Empresas' },
  contacts: { label: 'Contatos' },
  deals_line_items: { label: 'Negócios + Itens de Linha' },
};

const modeConfig: Record<ExportMode, { label: string; description: string; entities: ExportableEntity[] }> = {
  sold: {
    label: 'Vendas concluídas',
    description: 'Histórico financeiro: Empresas, Contatos, Negócios e Itens de Linha.',
    entities: ['companies', 'contacts', 'deals_line_items'],
  },
  inProgress: {
    label: 'Em andamento (Não implementado)',
    description: 'Pipeline ativo.',
    entities: [],
  },
  lost: {
    label: 'Perdidos (Não implementado)',
    description: 'Histórico comercial.',
    entities: [],
  },
};

export default function HomePage() {
  const [mode, setMode] = useState<ExportMode>('sold');
  const [selectedEntity, setSelectedEntity] = useState<ExportableEntity>('companies');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRunLogs, setLastRunLogs] = useState<string | null>(null);

  const startExport = async () => {
    if (isLoading || !selectedEntity) return;

    setIsLoading(true);
    setError(null);
    setLastRunLogs(null);

    try {
      const apiUrl = `/api/export?mode=${mode}&entities=${selectedEntity}`;
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `O servidor respondeu com o status ${response.status}`);
      }

      const { csvContent, logContent, fileName } = data;

      // Iniciar o download do CSV
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      // Exibir os logs na tela
      setLastRunLogs(logContent);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.');
    } finally {
      setIsLoading(false);
    }
  };

  const isModeImplemented = true; // Always true now as we implemented all logic

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Migração Spotter → HubSpot</h1>
      <p>Exporte dados do Spotter para arquivos CSV prontos para importação no HubSpot.</p>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#f9f9f9' }}>

        <div style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="import-mode" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            1. Escolha o Modo de Exportação
          </label>
          <select
            id="import-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as ExportMode)}
            disabled={isLoading}
            style={{ width: '100%', padding: '10px', fontSize: '16px', borderRadius: '5px', border: '1px solid #ccc' }}
          >
            {Object.entries(modeConfig).map(([key, config]) => (
              <option key={key} value={key}>{config.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="entity-select" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            2. Escolha o Arquivo para Gerar
          </label>
           <select
            id="entity-select"
            value={selectedEntity}
            onChange={(e) => setSelectedEntity(e.target.value as ExportableEntity)}
            disabled={isLoading}
            style={{ width: '100%', padding: '10px', fontSize: '16px', borderRadius: '5px', border: '1px solid #ccc' }}
          >
            {modeConfig[mode].entities.map(entity => (
              <option key={entity} value={entity}>{entityConfig[entity].label}</option>
            ))}
          </select>
        </div>

        <button
          onClick={startExport}
          disabled={isLoading || !isModeImplemented}
          style={{
            width: '100%',
            padding: '12px 20px',
            fontSize: '18px',
            cursor: (isLoading || !isModeImplemented) ? 'not-allowed' : 'pointer',
            backgroundColor: (isLoading || !isModeImplemented) ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            fontWeight: 'bold'
          }}
        >
          {isLoading ? 'Exportando...' : 'Gerar e Baixar CSV'}
        </button>
      </div>

      {error && (
        <div style={{ color: 'red', marginTop: '1.5rem', border: '1px solid red', padding: '1rem', borderRadius: '5px', backgroundColor: '#ffebee' }}>
          <strong>Erro:</strong> {error}
        </div>
      )}

      {lastRunLogs && (
        <div style={{ marginTop: '1.5rem', border: '1px solid #ccc', padding: '1rem', borderRadius: '5px', backgroundColor: '#fff' }}>
          <h2>Logs da Última Execução</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', maxHeight: '400px', overflowY: 'auto', margin: 0, fontFamily: 'monospace', fontSize: '14px', backgroundColor: '#f5f5f5', padding: '1rem', borderRadius: '5px' }}>
            {lastRunLogs}
          </pre>
        </div>
      )}
    </div>
  );
}
