// Misma regla en los dos lugares que la usan (pagos.module.ts y
// tenants.module.ts): pagado si tiene fecha_pago, vencido si ya paso la
// fecha de vencimiento sin pagar, si no pendiente. No se persiste en ningun
// lado -- se calcula siempre al leer.
export function estadoPagoCalculado(
  fechaPago: Date | null,
  fechaVencimiento: Date,
): 'pagado' | 'vencido' | 'pendiente' {
  if (fechaPago) return 'pagado';
  return new Date(fechaVencimiento) < new Date() ? 'vencido' : 'pendiente';
}

// Positivo = dias que faltan, 0 o negativo = ya vencio (o vence hoy).
export function diasRestantes(fechaVencimiento: Date): number {
  const ms = new Date(fechaVencimiento).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
