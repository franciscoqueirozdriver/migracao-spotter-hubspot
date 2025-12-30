'use client';

import React, { useState } from 'react';

const ENTITIES = [
  { id: 'leads', label: 'Leads' },
  { id: 'companies', label: 'Empresas (Companies)' },
  { id: 'contacts', label: 'Contatos (Persons)' },
  { id: 'users', label: 'Usuários' },
  { id: 'sellers', label: 'Vendedores' },
  { id: 'groups', label: 'Grupos (Times)' },
  { id: 'losts', label: 'Leads Descartados (Losts)' },
  { id: 'history', label: 'Histórico de Transferência' },
  { id: 'meetings', label: 'Agendamentos (Meetings)' },
  { id: 'funnels', label: 'Funis de Vendas' },
  { id: 'stages', label: 'Etapas de Funil' },
  { id: 'sources', label: 'Origens (Sources)' },
  { id: 'discard_reasons', label: 'Motivos de Descarte' },
  { id: 'products', label: 'Produtos' },
  { id: 'tasks_type', label: 'Tipos de Tarefa' },
  { id: 'custom_fields_leads', label: 'Campos Custom (Leads)' },
  { id: 'custom_fields_orgs', label: 'Campos Custom (Empresas)' },
];

export default function BackupPage() {
  const [loading, setLoading] = useState<string | null>(null);

  const handleDownload = async (entityId: string, filename: string) => {
    try {
      setLoading(entityId);
      const res = await fetch(`/api/backup-total/export?entity=${entityId}`);

      const contentType = res.headers.get('Content-Type');
      if (contentType && contentType.includes('application/json')) {
         const json = await res.json();
         alert(`Erro ao baixar: ${json.message || 'Erro desconhecido'}`);
         return;
      }

      if (!res.ok) {
        alert(`Erro HTTP: ${res.status}`);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename; // The API also sends Content-Disposition, but this is a fallback
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Falha na conexão ou erro de rede.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="p-8 font-sans">
      <h1 className="text-2xl font-bold mb-4">Admin / Backup Total</h1>
      <p className="mb-6 text-gray-600">
        Devido ao volume de dados, o backup total foi dividido por entidade.
        Clique para baixar o CSV completo de cada uma (streaming direto do Spotter).
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ENTITIES.map((ent) => (
          <div key={ent.id} className="border p-4 rounded shadow-sm hover:shadow-md transition bg-white">
            <h3 className="font-semibold text-lg mb-2">{ent.label}</h3>
            <button
              onClick={() => handleDownload(ent.id, `${ent.id}.csv`)}
              disabled={loading !== null}
              className={`px-4 py-2 rounded text-white font-medium w-full
                ${loading === ent.id ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}
                ${loading !== null && loading !== ent.id ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {loading === ent.id ? 'Baixando...' : 'Baixar CSV'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
