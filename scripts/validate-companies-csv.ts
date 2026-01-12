// scripts/validate-companies-csv.ts
import { buildCsv, sanitizeCsvValue } from '../lib/csv.js';

const COMPANY_HEADERS = [
  'Nome da empresa',
  'Nome de domínio da empresa',
  'CNPJ',
  'Endereço',
  'Número',
  'Complemento',
  'Bairro',
  'Código postal',
  'Cidade',
  'Estado/Região',
  'País/Região',
  'spotter_organization_id',
];

function runValidationTest() {
  console.log('Running CSV validation test...');

  const problematicData = {
    name: 'Empresa com "Aspas" e\nQuebra de Linha',
    address: 'Rua das Vírgulas, nº 123',
    complement: null,
    cnpj: '12345678901234',
  };

  const rowData = [
    sanitizeCsvValue(problematicData.name),
    sanitizeCsvValue('domain.com'),
    sanitizeCsvValue(problematicData.cnpj),
    sanitizeCsvValue(problematicData.address),
    sanitizeCsvValue('123'),
    sanitizeCsvValue(problematicData.complement),
    sanitizeCsvValue('Bairro'),
    sanitizeCsvValue('12345-678'),
    sanitizeCsvValue('Cidade'),
    sanitizeCsvValue('Estado'),
    sanitizeCsvValue('País'),
    sanitizeCsvValue('org-id-123'),
  ];

  try {
    const csv = buildCsv(COMPANY_HEADERS, [rowData]);

    // The buildCsv function itself validates the column count, so if it doesn't throw, that part of the test has passed.

    const expectedName = '"Empresa com ""Aspas"" e Quebra de Linha"';
    if (rowData[0] !== expectedName) {
        throw new Error(`Test failed: Name sanitization is incorrect. Expected ${expectedName}, got ${rowData[0]}`);
    }

    const expectedAddress = '"Rua das Vírgulas, nº 123"';
    if (rowData[3] !== expectedAddress) {
        throw new Error(`Test failed: Address sanitization is incorrect. Expected ${expectedAddress}, got ${rowData[3]}`);
    }

    console.log('CSV validation test passed!');
    console.log('Generated CSV:\n', csv);
  } catch (error) {
    console.error('CSV validation test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

runValidationTest();
