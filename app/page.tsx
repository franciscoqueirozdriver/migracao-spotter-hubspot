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
    description: 'Pipeline ativo: Empresas, Contatos e Negócios sem itens de linha.',
    entities: ['companies', 'contacts', 'deals_line_items'], // Assuming deals would be an entity
  },
  lost: {
    label: 'Perdidos (Não implementado)',
    description: 'Histórico comercial: Empresas, Contatos e Negócios perdidos.',
    entities: ['companies', 'contacts', 'deals_line_items'], // Assuming deals would be an entity
  },
};

const getDefaultSelection = (mode: ExportMode): Record<ExportableEntity, boolean> => {
  const selection: Partial<Record<ExportableEntity, boolean>> = {};
  for (const entity of modeConfig[mode].entities) {
    selection[entity] = true;
  }
  return selection as Record<ExportableEntity, boolean>;
};

export default function HomePage() {
  const [mode, setMode] = useState<ExportMode>('sold');
  const [selectedEntities, setSelectedEntities] = useState<Record<ExportableEntity, boolean>>(getDefaultSelection(mode));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedEntities(getDefaultSelection(mode));
  }, [mode]);

  const handleEntityChange = (entity: ExportableEntity) => {
    setSelectedEntities(prev => ({ ...prev, [entity]: !prev[entity] }));
  };

  const startExport = async () => {
    if (isLoading) return;

    const entitiesToExport = Object.entries(selectedEntities)
      .filter(([_, isSelected]) => isSelected)
      .map(([entity]) => entity);

    if (entitiesToExport.length === 0) {
      setError('Selecione pelo menos um tipo de arquivo para exportar.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const apiUrl = `/api/export?mode=${mode}&entities=${entitiesToExport.join(',')}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `O servidor respondeu com o status ${response.status}`);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition');
      let fileName = `spotter_export_${mode}.zip`;

      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/);
        if (match && match[1]) {
          fileName = match[1];
        }
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
      setError(err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.');
    } finally {
      setIsLoading(false);
    }
  };

  const isModeImplemented = mode === 'sold';
  const isAnythingSelected = Object.values(selectedEntities).some(Boolean);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Migração Spotter → HubSpot</h1>
      <p>Exporte dados do Spotter para arquivos CSV prontos para importação no HubSpot.</p>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#f9f9f9' }}>

        <div style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="import-mode" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            1. O que você deseja importar?
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
          <p style={{ fontSize: '14px', color: '#666', marginTop: '0.5rem' }}>
            {modeConfig[mode].description}
          </p>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>
            2. Selecione os Arquivos para Gerar
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            {modeConfig[mode].entities.map(entity => (
              <div key={entity} style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  id={`checkbox-${entity}`}
                  checked={selectedEntities[entity] || false}
                  onChange={() => handleEntityChange(entity)}
                  disabled={isLoading}
                  style={{ marginRight: '0.5rem', height: '18px', width: '18px' }}
                />
                <label htmlFor={`checkbox-${entity}`}>{entityConfig[entity].label}</label>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={startExport}
          disabled={isLoading || !isModeImplemented || !isAnythingSelected}
          style={{
            width: '100%',
            padding: '12px 20px',
            fontSize: '18px',
            cursor: (isLoading || !isModeImplemented || !isAnythingSelected) ? 'not-allowed' : 'pointer',
            backgroundColor: (isLoading || !isModeImplemented || !isAnythingSelected) ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            fontWeight: 'bold'
          }}
        >
          {isLoading ? 'Exportando...' : `Gerar e Baixar Arquivos`}
        </button>
      </div>

      {error && (
        <div style={{ color: 'red', marginTop: '1.5rem', border: '1px solid red', padding: '1rem', borderRadius: '5px', backgroundColor: '#ffebee' }}>
          <strong>Erro:</strong> {error}
        </div>
      )}
    </div>
  );
}
