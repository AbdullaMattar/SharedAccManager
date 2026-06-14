declare module "xlsx-populate" {
  interface Cell {
    value(val?: any): any;
  }
  interface Sheet {
    name(name?: string): any;
    cell(address: string): Cell;
    usedRange(): { value(): any[][] } | null;
  }
  interface Workbook {
    sheet(nameOrIndex: string | number): Sheet;
    sheets(): Sheet[];
    addSheet(name: string, indexOrBeforeSheet?: number | Sheet): Sheet;
    outputAsync(opts?: { password?: string }): Promise<Buffer>;
  }
  const XlsxPopulate: {
    fromBlankAsync(): Promise<Workbook>;
    fromDataAsync(data: Buffer | ArrayBuffer, opts?: { password?: string }): Promise<Workbook>;
    fromFileAsync(path: string, opts?: { password?: string }): Promise<Workbook>;
  };
  export = XlsxPopulate;
}
