"use client";

import React, { useState } from 'react';

type ExportMode = 'sold' | 'inProgress' | 'lost';

const modeConfig: Record<ExportMode, { label: string; description: string; included: string[] }> = {
  sold: {
    label: 'Vendas concluídas',
    description: 'Histórico financeiro: Empresas, Contatos, Negócios e Itens de Linha.',
    included: ['Empresas', 'Contatos', 'Negócios + Itens de Linha'],
  },
  inProgress: {
    label: 'Em andamento (Não implementado)',
    description: 'Pipeline ativo: Empresas, Contatos e Negócios sem itens de linha.',
    included: ['Empresas', 'Contatos', 'Negócios'],
  },
  lost: {
    label: 'Perdidos (Não implementado)',
    description: 'Histórico comercial: Empresas, Contatos e Negócios perdidos.',
    included: ['Empresas', 'Contatos', 'Negócios'],
  },
};

export default function HomePage() {
  const [mode, setMode] = useState<ExportMode>('sold');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startExport = async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const apiUrl = `/api/export?mode=${mode}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `O servidor respondeu com o status ${response.status}`);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition');
      let fileName = `spotter_export_${mode}.zip`; // Fallback filename

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
            2. Arquivos Incluídos na Exportação
          </h3>
          <ul style={{ listStyleType: 'none', paddingLeft: 0, marginTop: '1rem' }}>
            {modeConfig[mode].included.map(item => (
              <li key={item} style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
                <span style={{ color: '#28a745', marginRight: '0.5rem', fontWeight: 'bold' }}>✓</span>
                {item}
              </li>
            ))}
          </ul>
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
