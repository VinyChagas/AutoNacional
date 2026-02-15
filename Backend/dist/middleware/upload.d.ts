/** Upload de um único arquivo (ex.: certificado) */
export declare const uploadSingle: (field?: string) => import("express").RequestHandler<import("express-serve-static-core").ParamsDictionary, any, any, import("qs").ParsedQs, Record<string, any>>;
/** Upload de múltiplos arquivos (ex.: lote de certificados) */
export declare const uploadArray: (field?: string, maxCount?: number) => import("express").RequestHandler<import("express-serve-static-core").ParamsDictionary, any, any, import("qs").ParsedQs, Record<string, any>>;
/** Upload de planilha (Excel) */
export declare const uploadPlanilha: (field?: string) => import("express").RequestHandler<import("express-serve-static-core").ParamsDictionary, any, any, import("qs").ParsedQs, Record<string, any>>;
//# sourceMappingURL=upload.d.ts.map