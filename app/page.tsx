"use client";

import React, { useState } from 'react';

export default function HomePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/export-products');

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Falha ao exportar produtos.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'products_hubspot.csv';
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
      {error && <p style={{ color: 'red', marginTop: '1rem' }}>Erro: {error}</p>}
    </div>
  );
}
