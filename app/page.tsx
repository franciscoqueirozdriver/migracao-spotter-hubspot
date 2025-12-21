"use client";

import React, { useState } from 'react';

type ExportMode = 'total'; // Simplified to just 'total' as per requirements
type ExportableEntity = 'companies' | 'contacts' | 'deals_line_items';

const entityConfig: Record<ExportableEntity, { label: string, endpoint: string }> = {
  companies: { label: 'Empresas', endpoint: 'companies' },
  contacts: { label: 'Contatos', endpoint: 'contacts' },
  deals_line_items: { label: 'Negócios + Itens de Linha', endpoint: 'deals_line_items' },
};

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [activeExport, setActiveExport] = useState<ExportableEntity | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startExport = async (entity: ExportableEntity) => {
    if (isLoading) return;

    setIsLoading(true);
    setActiveExport(entity);
    setError(null);

    try {
      // "A query deve ser do tipo: GET /api/export?mode=total&entity=..."
      const apiUrl = `/api/export?mode=total&entity=${entity}`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        // Tenta ler o erro JSON
        let errorMsg = `Erro ${response.status}`;
        try {
            const data = await response.json();
            errorMsg = data.message || errorMsg;
        } catch (e) {
            // Ignora erro de parse e usa status
        }
        throw new Error(errorMsg);
      }

      // Se for sucesso, pega o blob
      const blob = await response.blob();

      // Pega o filename do header se possível, ou usa fallback
      const disposition = response.headers.get('Content-Disposition');
      let fileName = `${entity}.csv`;
      if (disposition && disposition.includes('filename=')) {
          const match = disposition.match(/filename="?([^"]+)"?/);
          if (match && match[1]) fileName = match[1];
      }

      // Iniciar o download
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
      setActiveExport(null);
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '800px', margin: 'auto' }}>
      <h1>Migração Spotter → HubSpot</h1>
      <p>Exportação de dados (Modo Total)</p>

      <div style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1.5rem', backgroundColor: '#f9f9f9' }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Exportar CSV</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Botão Empresas */}
          <button
            onClick={() => startExport('companies')}
            disabled={isLoading}
            style={{
              padding: '12px 20px',
              fontSize: '16px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              backgroundColor: (isLoading && activeExport !== 'companies') ? '#eee' : '#0070f3',
              color: (isLoading && activeExport !== 'companies') ? '#999' : 'white',
              border: 'none',
              borderRadius: '5px',
              fontWeight: 'bold',
              opacity: (isLoading && activeExport !== 'companies') ? 0.6 : 1
            }}
          >
            {activeExport === 'companies' ? 'Exportando Empresas...' : 'Empresas'}
          </button>

          {/* Botão Contatos */}
          <button
            onClick={() => startExport('contacts')}
            disabled={isLoading}
            style={{
              padding: '12px 20px',
              fontSize: '16px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              backgroundColor: (isLoading && activeExport !== 'contacts') ? '#eee' : '#0070f3',
              color: (isLoading && activeExport !== 'contacts') ? '#999' : 'white',
              border: 'none',
              borderRadius: '5px',
              fontWeight: 'bold',
              opacity: (isLoading && activeExport !== 'contacts') ? 0.6 : 1
            }}
          >
            {activeExport === 'contacts' ? 'Exportando Contatos...' : 'Contatos'}
          </button>

          {/* Botão Negócios + Itens */}
          <button
            onClick={() => startExport('deals_line_items')}
            disabled={isLoading}
            style={{
              padding: '12px 20px',
              fontSize: '16px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              backgroundColor: (isLoading && activeExport !== 'deals_line_items') ? '#eee' : '#0070f3',
              color: (isLoading && activeExport !== 'deals_line_items') ? '#999' : 'white',
              border: 'none',
              borderRadius: '5px',
              fontWeight: 'bold',
              opacity: (isLoading && activeExport !== 'deals_line_items') ? 0.6 : 1
            }}
          >
            {activeExport === 'deals_line_items' ? 'Exportando Negócios...' : 'Negócios + Itens de Linha'}
          </button>

        </div>
      </div>

      {error && (
        <div style={{ color: 'red', marginTop: '1.5rem', border: '1px solid red', padding: '1rem', borderRadius: '5px', backgroundColor: '#ffebee' }}>
          <strong>Erro:</strong> {error}
        </div>
      )}
    </div>
  );
}
