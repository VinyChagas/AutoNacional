import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client', () => ({
  prisma: {
    certificado: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../services/certificado-storage.service', () => ({
  removerArquivosCertificado: vi.fn(async (paths: Array<string | null>) => ({
    attempted: paths.filter(Boolean) as string[],
    removed: paths.filter(Boolean) as string[],
    failed: [],
  })),
}));

import { prisma } from '../db/client';
import { removerArquivosCertificado } from '../services/certificado-storage.service';
import {
  existeCertificadoAtivoParaCnpj,
  listarPorCnpjNormalizado,
  removerTodosPorCnpj,
} from './certificados';

const mockedFindMany = prisma.certificado.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockedDeleteMany = prisma.certificado.deleteMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockedStorage = removerArquivosCertificado as unknown as ReturnType<
  typeof vi.fn
>;

describe('certificados repo — remoção e existência', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listarPorCnpjNormalizado filtra equivalentes e ignora estranhos', async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: 1,
        cnpj: '12345678000199',
        arquivo: 'a.pfx',
        senhaCriptografada: null,
        dataValidade: null,
        empresaId: '1',
        contabilidadeId: null,
        dataCadastro: new Date(),
      },
      {
        id: 2,
        cnpj: '12345678000199XXX',
        arquivo: 'b.pfx',
        senhaCriptografada: null,
        dataValidade: null,
        empresaId: null,
        contabilidadeId: null,
        dataCadastro: new Date(),
      },
    ]);

    const list = await listarPorCnpjNormalizado('12.345.678/0001-99');
    expect(list.map((c) => c.id)).toEqual([1]);
  });

  it('removerTodosPorCnpj apaga TODOS os registros e limpa Storage', async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: 10,
        cnpj: '12345678000199',
        arquivo: 'path/old1.pfx',
        senhaCriptografada: 'x',
        dataValidade: '01/01/2025',
        empresaId: '5',
        contabilidadeId: 1,
        dataCadastro: new Date(),
      },
      {
        id: 11,
        cnpj: '12345678000199',
        arquivo: 'path/old2.pfx',
        senhaCriptografada: 'y',
        dataValidade: '01/01/2026',
        empresaId: '5',
        contabilidadeId: 1,
        dataCadastro: new Date(),
      },
    ]);
    mockedDeleteMany.mockResolvedValue({ count: 2 });

    const result = await removerTodosPorCnpj('12345678000199');
    expect(result?.deletedCount).toBe(2);
    expect(mockedDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: [10, 11] } },
    });
    expect(mockedStorage).toHaveBeenCalledWith([
      'path/old1.pfx',
      'path/old2.pfx',
    ]);
  });

  it('existeCertificadoAtivoParaCnpj fica false após lista vazia', async () => {
    mockedFindMany.mockResolvedValue([]);
    expect(await existeCertificadoAtivoParaCnpj('12345678000199')).toBe(false);
  });

  it('existeCertificadoAtivoParaCnpj true quando há registro', async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: 1,
        cnpj: '12345678000199',
        arquivo: 'x.pfx',
        senhaCriptografada: null,
        dataValidade: null,
        empresaId: null,
        contabilidadeId: null,
        dataCadastro: new Date(),
      },
    ]);
    expect(await existeCertificadoAtivoParaCnpj('12345678000199')).toBe(true);
  });

  it('removerTodosPorCnpj retorna null se não há certificados', async () => {
    mockedFindMany.mockResolvedValue([]);
    expect(await removerTodosPorCnpj('12345678000199')).toBeNull();
    expect(mockedDeleteMany).not.toHaveBeenCalled();
  });
});
