"use client";

import React, { useState } from 'react';

type ExportMode = 'sold' | 'inProgress' | 'lost';
type ExportEntity = 'companies' | 'contacts' | 'deals_line_items';

const modeConfig: Record<ExportMode, { label: string; description: string; supportedEntities: ExportEntity[] }> = {
  sold: {
    label: 'Vendas concluídas',
    description: 'Exporte empresas, contatos ou negócios relacionados a vendas concluídas.',
    supportedEntities: ['companies', 'contacts', 'deals_line_items'],
  },
  inProgress: {
    label: 'Em andamento',
    description: 'Funcionalidade ainda não implementada.',
    supportedEntities: [],
  },
  lost: {
    label: 'Perdidos',
    description: 'Funcionalidade ainda não implementada.',
    supportedEntities: [],
  },
};

const entityLabels: Record<ExportEntity, string> = {
    companies: 'Empresas',
    contacts: 'Contatos',
    deals_line_items: 'Negócios + Itens de Linha',
};

export default function HomePage() {
  const [mode, setMode] = useState<ExportMode>('sold');
  const [selectedEntity, setSelectedEntity] = useState<ExportEntity>('companies');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startExport = async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/export?mode=${mode}&export=${selectedEntity}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Erro HTTP: ${response.status}`);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition');
      let fileName = `${selectedEntity}_${mode}.csv`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="([^"]+)"/);
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

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Migração Spotter → HubSpot</h1>
      <p>Exporte dados do Spotter para arquivos CSV prontos para importação no HubSpot.</p>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#f9f9f9' }}>

        <div style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="import-mode" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            1. O que você deseja importar?
          </label>
          <select id="import-mode" value={mode} onChange={(e) => setMode(e.target.value as ExportMode)} disabled={isLoading} style={{ width: '100%', padding: '10px', fontSize: '16px', borderRadius: '5px', border: '1px solid #ccc' }}>
            {Object.keys(modeConfig).map(modeKey => (
              <option key={modeKey} value={modeKey}>{modeConfig[modeKey as ExportMode].label}</option>
            ))}
          </select>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '0.5rem' }}>{modeConfig[mode].description}</p>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.5rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>2. Selecione o Arquivo para Gerar</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            {Object.keys(entityLabels).map(entityStr => {
              const entity = entityStr as ExportEntity;
              const isSupported = modeConfig[mode].supportedEntities.includes(entity);
              return (
                <div key={entity} style={{ display: 'flex', alignItems: 'center', opacity: isSupported ? 1 : 0.5 }}>
                  <input type="radio" id={`radio-${entity}`} name="entity" value={entity} checked={selectedEntity === entity} onChange={() => setSelectedEntity(entity)} disabled={isLoading || !isSupported} style={{ marginRight: '0.5rem', height: '18px', width: '18px' }} />
                  <label htmlFor={`radio-${entity}`}>{entityLabels[entity]}</label>
                  {!isSupported && <span style={{ fontSize: '12px', color: '#999', marginLeft: '1rem' }}>(Indisponível neste modo)</span>}
                </div>
              );
            })}
          </div>
        </div>

        <button onClick={startExport} disabled={isLoading} style={{ width: '100%', padding: '12px 20px', fontSize: '18px', cursor: isLoading ? 'not-allowed' : 'pointer', backgroundColor: isLoading ? '#ccc' : '#28a745', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold' }}>
          {isLoading ? 'Exportando...' : `Gerar e Baixar CSV`}
        </button>
      </div>

      {error && <p style={{ color: 'red', marginTop: '1.5rem', border: '1px solid red', padding: '1rem', borderRadius: '5px' }}><strong>Erro:</strong> {error}</p>}
    </div>
  );
}
