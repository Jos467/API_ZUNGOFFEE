# Contexto completo para poblar (seed) la base de datos — Zungo Coffee

Documento de referencia para diseñar un script que inserte varios miles de registros realistas en la base de datos de producción/staging (Supabase Postgres) del proyecto Zungo Coffee. Asume que quien lo lee no conoce nada del proyecto todavía. Todo lo que sigue fue verificado hoy contra la base real (consultas a `information_schema`, `pg_constraint`, `pg_policies`, `pg_proc`, y conteos de filas reales) — no son suposiciones sobre el código.

---

## 1. Qué es el sistema (resumen)

SaaS multi-tenant para bodegas de café en Honduras. Cada bodega es un **tenant** aislado. El café pasa por etapas (uva → húmedo → pergamino_seco → tostado → molido), cambiando de unidad de medida en cada una. Una bodega **compra** café a proveedores (genera inventario = `lotes`), opcionalmente lo **procesa** (tuesta/muele, genera un lote derivado nuevo sin borrar el original), y lo **vende** a clientes (descuenta saldo del lote). Cada operación queda registrada en una bitácora de auditoría.

Backend: NestJS + Prisma sobre PostgreSQL (Supabase), desplegado en Render (`https://zungo-coffee-api.onrender.com`). Repo: `Jos467/API_ZUNGOFFEE`.

---

## 2. Cómo conectarse (importante: quién bypasea RLS)

- La base tiene Row Level Security (RLS) activo en casi todas las tablas de `public`.
- La `DATABASE_URL`/`DIRECT_URL` del backend (ver `.env`) conecta como el rol `postgres` de Supabase — **verificado ahora mismo**: `SELECT current_user` devuelve `postgres`, que es el owner de las tablas. Postgres no aplica RLS al owner de la tabla salvo que se use `FORCE ROW LEVEL SECURITY` (no está activado aquí). **Conclusión: un script que se conecte con esas mismas credenciales inserta directo, sin necesidad de simular JWT ni sesión de ningún usuario.**
- Para un script de carga masiva, usar `DIRECT_URL` (puerto 5432, conexión directa) en vez de `DATABASE_URL` (puerto 6543, pooler en modo transacción vía pgbouncer) — el pooler en modo transacción puede dar problemas con `COPY`, prepared statements reutilizados entre "transacciones" lógicas, etc. Para miles de INSERTs, mejor usar `DIRECT_URL`, o `DATABASE_URL` pero con inserts por lotes (`INSERT ... VALUES (...), (...), ...` de a cientos) más que una transacción gigante.

---

## 3. Restricción crítica: `usuarios` NO se puede poblar en masa

`usuarios.auth_uid` es `UUID NOT NULL UNIQUE`, con foreign key a `auth.users(id)` (la tabla de Supabase Auth). **No se puede insertar un registro en `usuarios` sin que exista antes un usuario real en Supabase Auth** (no es un simple UUID random — Supabase Auth valida la integridad y el login real depende de `encrypted_password` con el hash correcto de GoTrue, que no es trivial de replicar a mano).

Esto significa:
- **No generar miles de `usuarios`.** Generar como mucho unos pocos más (decenas, no miles) si hace falta variedad de "quién hizo cada operación", creándolos vía la Supabase Admin API (`POST {SUPABASE_URL}/auth/v1/admin/users` con la `service_role key`, igual que hace `src/usuarios/usuarios.module.ts` en el backend) y después insertando en `usuarios` con el `id` (UUID) que devuelve esa llamada.
- Ya existen **5 usuarios reales** utilizables para atribuir miles de compras/ventas/etc (ver sección 9): 1 `admin_bodega`, 1 `empleado`, 3 `super_admin`. Lo más simple y rápido es generar el volumen grande de datos transaccionales (`compras`, `ventas`, `procesamiento_cafe`, etc.) referenciando estos `usuario_id` existentes (3 y 7, que son los que pertenecen al tenant 5), en vez de crear cientos de usuarios nuevos.
- Igual de cierto para `tenants`: si se quiere simular varias bodegas (multi-tenant real), cada tenant nuevo necesita al menos un usuario `admin_bodega` con su propia cuenta de Auth — mismo proceso, no es gratis. **Decisión pendiente para quien diseñe el script**: ¿un solo tenant con miles de registros, o varios tenants con volumen repartido? Ver sección 10.

---

## 4. El único trigger real de base de datos

Todo lo demás en el sistema (ver sección 5) es lógica de aplicación (NestJS), **no** triggers de Postgres. Hay exactamente un trigger, confirmado ahora mismo consultando `information_schema.triggers` y `pg_get_functiondef`:

```sql
-- Trigger: trg_crear_lote_desde_compra
-- AFTER INSERT ON compras_detalle, FOR EACH ROW
CREATE OR REPLACE FUNCTION public.fn_crear_lote_desde_compra()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO lotes (
    tenant_id, estado_cafe_id, compra_detalle_id, variedad_id, altura_id,
    cantidad_inicial, saldo, costo_unitario
  ) VALUES (
    NEW.tenant_id, NEW.estado_cafe_id, NEW.id, NEW.variedad_id, NEW.altura_id,
    NEW.cantidad, NEW.cantidad, NEW.costo_unitario
  );
  RETURN NEW;
END;
$function$
```

**Implicación práctica para el script**: si insertás filas directo en `compras_detalle` (aunque sea con `INSERT` masivo/`COPY`), este trigger se dispara solo y te crea automáticamente el `lotes` correspondiente, con `saldo = cantidad_inicial = cantidad` de la línea de compra. **No hay que insertar manualmente en `lotes` para el caso de compras** — de hecho, si lo hacés manualmente además del trigger, vas a duplicar lotes.

---

## 5. Lógica que SÍ hay que replicar a mano (no tiene trigger)

Todo esto vive en el código NestJS (`src/ventas/ventas.service.ts`, `src/procesamiento-cafe/procesamiento.module.ts`, y el patrón repetido de bitácora en cada módulo), no en la base de datos. Si el script inserta directo por SQL sin pasar por la API, tiene que reproducir esto manualmente:

### 5.1 Ventas (`POST /ventas` en el código real)
Por cada línea de venta:
1. Verificar `lotes.saldo >= cantidad` (si no, en la app se rechaza con 400 — en un seed script simplemente no generar esa combinación, o validarlo antes de insertar).
2. Insertar en `ventas_detalle`.
3. `UPDATE lotes SET saldo = saldo - cantidad WHERE id = lote_id`.
4. Insertar en `inventario_movimientos` con `tipo_movimiento_id = 2` (`salida_venta`), `cantidad`, `referencia_id = venta.id`, `usuario_id`.
5. `ventas.total = SUM(cantidad * precio_unitario)` de todas sus líneas (calculado en la app antes del insert, no es una columna generada por la base).

### 5.2 Procesamiento (`POST /procesamiento`)
Tostar o moler un lote:
1. Elegir `lote_origen` con saldo suficiente para `cantidad_entrada`.
2. Validar transición de estado (tabla en sección 7).
3. Calcular costo heredado: `costo_unitario_destino = (costo_unitario_origen * cantidad_entrada) / cantidad_salida` (si el origen tiene `costo_unitario`, si no, `null`). Las unidades cambian entre origen y destino (ej. quintal → libra), por eso no se copia el costo tal cual.
4. Insertar el lote nuevo (`lotes`) con `lote_origen_id = origen.id`, `compra_detalle_id = NULL`, `cantidad_inicial = saldo = cantidad_salida`, `costo_unitario` calculado, mismo `variedad_id`/`altura_id` que el origen.
5. `UPDATE lotes SET saldo = saldo - cantidad_entrada WHERE id = lote_origen_id`.
6. Insertar `procesamiento_cafe` (`lote_origen_id`, `lote_destino_id`, `cantidad_entrada`, `cantidad_salida`, `usuario_id`).
7. Insertar **dos** filas en `inventario_movimientos`: una `tipo_movimiento_id = 3` (`salida_transformacion`) sobre el lote origen, otra `tipo_movimiento_id = 4` (`entrada_transformacion`) sobre el lote destino.

### 5.3 Bitácora — se inserta a mano en CADA operación de escritura
No existe un trigger genérico de auditoría. Cada módulo (`compras`, `ventas`, `procesamiento`, `proveedores`, `clientes`) inserta manualmente una fila en `bitacora` después de cada `INSERT`/`UPDATE` exitoso:

```sql
INSERT INTO bitacora (tenant_id, usuario_id, tabla_afectada_id, registro_id, accion_id, fecha)
VALUES (:tenant_id, :usuario_id, :tabla_afectada_id, :registro_id, :accion_id, now());
```

`tabla_afectada_id` (FK a `tablas_sistema`, ver catálogo en sección 8) y `accion_id` (FK a `acciones_bitacora`: 1=INSERT, 2=UPDATE, 3=DELETE) determinan qué se registra. Si el script quiere que `GET /bitacora` (usado por el panel web) muestre actividad realista, tiene que generar estas filas junto con cada compra/venta/procesamiento/proveedor/cliente que inserte — no es automático.

### 5.4 Compras — total y `usuario_id`
`compras.total = SUM(cantidad * costo_unitario)` de sus líneas, calculado antes del insert (no es columna generada). Solo `estado_cafe_id` 1 (uva), 2 (húmedo) o 3 (pergamino_seco) son válidos para una línea de compra — son los únicos estados que "se compran" (ver tabla de ciclo de vida en sección 7).

### 5.5 Anulaciones (`anulada`/`anulado`) — opcional para datos de seed
Si el script quiere generar algunos registros anulados para probar esos flujos: anular una compra pone `saldo = 0` en todos sus lotes generados (solo si ningún lote tuvo movimiento posterior — si vas a generar anuladas, hacelo sobre compras/ventas/procesamientos que no tengan nada encadenado después, o la regla de negocio real lo rechazaría). Anular una venta devuelve el `saldo` al lote. No es necesario para tener "miles de registros" — es un detalle opcional de realismo, no bloqueante.

---

## 6. Catálogos (ya poblados — NO tocar, solo referenciar por ID)

Estas tablas ya tienen datos fijos en la base real (consultado ahora mismo). El script de seed **no debe insertar en ellas**, solo usar estos IDs como foreign keys:

```
estados_cafe: 1=uva(unidad 1), 2=humedo(unidad 2), 3=pergamino_seco(unidad 2), 4=tostado_alto(unidad 3), 5=tostado_medio(unidad 3), 6=tostado_bajo(unidad 3), 7=molido(unidad 3)
unidades_medida: 1=galon, 2=quintal, 3=libra
variedades_cafe: 1=Catuai, 2=Bourbon, 3=Typica, 4=Pacas, 5=Icatu, 6=Lempira, 7=Parainema
niveles_altura: 1=estricta(msnm_min 1350), 2=media(1200-1350), 3=estandar(msnm_max 1200)
proveedores_tipo: 1=pequeno, 2=mediano, 3=grande
clientes_tipo: 1=persona_natural, 2=cafeteria_pequena, 3=cafeteria_mediana, 4=cafeteria_grande, 5=distribuidor
metodos_pago: 1=efectivo, 2=transferencia, 3=cheque
roles: 1=super_admin, 2=admin_bodega, 3=empleado
estados_tenant: 1=activo, 2=suspendido
tipos_movimiento_inventario: 1=entrada_compra, 2=salida_venta, 3=salida_transformacion, 4=entrada_transformacion, 5=ajuste_positivo, 6=ajuste_negativo
acciones_bitacora: 1=INSERT, 2=UPDATE, 3=DELETE
tablas_sistema: 1=compras, 2=compras_detalle, 3=lotes, 4=procesamiento_cafe, 5=ventas, 6=ventas_detalle, 7=proveedores, 8=clientes, 9=usuarios, 10=tenants
estados_pago: 1=pendiente, 2=pagado, 3=vencido
tipos_notificacion: 1=pago_pendiente, 2=stock_bajo, 3=venta_registrada, 4=aviso_general
plataformas_dispositivo: 1=ios, 2=android
estados_solicitud: 1=pendiente, 2=procesada, 3=rechazada
```

---

## 7. Reglas de negocio que la base fuerza con CHECK constraints

Confirmado con `pg_get_constraintdef` — insertar fuera de estos rangos falla con error de constraint, no es solo validación de la API:

```
proveedores.sexo            IN ('M','F') o NULL
compras.total                >= 0
compras_detalle.cantidad     > 0
compras_detalle.costo_unitario >= 0
lotes.cantidad_inicial       > 0
lotes.saldo                  >= 0
lotes: exactamente uno de (compra_detalle_id, lote_origen_id) debe ser NOT NULL, el otro NULL
       (un lote nace de una compra O de un procesamiento, nunca de ambos ni de ninguno)
procesamiento_cafe.cantidad_entrada  > 0
procesamiento_cafe.cantidad_salida   > 0
ventas.total                  >= 0
ventas_detalle.cantidad       > 0
ventas_detalle.precio_unitario >= 0
```

**Transiciones válidas de procesamiento** (aplicado en código, no en constraint de base, pero rompe la lógica de negocio si se ignora):
```
pergamino_seco (3) → tostado_alto (4) | tostado_medio (5) | tostado_bajo (6)
tostado_alto/medio/bajo (4,5,6) → molido (7)
Cualquier otra combinación no es válida (ej. uva→tostado, pergamino→molido directo).
```

**Precisión decimal** (importa para no generar valores que se trunquen o rechacen):
```
compras_detalle.humedad         DECIMAL(4,2)  -- máx 99.99 (humedad en %, 0-100 razonable)
compras_detalle.cantidad        DECIMAL(8,2)  -- máx 999999.99
compras_detalle.costo_unitario  DECIMAL(10,2)
lotes.cantidad_inicial / saldo  DECIMAL(8,2)
lotes.costo_unitario            DECIMAL(10,2)
procesamiento_cafe.cantidad_*   DECIMAL(8,2)
ventas_detalle.cantidad         DECIMAL(8,2)
ventas_detalle.precio_unitario  DECIMAL(10,2)
compras.total / ventas.total    DECIMAL(12,2)
pagos_tenant.monto              DECIMAL(10,2)
```

**Tipos BigInt vs Int** (relevante si el script es en un lenguaje con límites de entero, o si genera JSON en algún punto intermedio): `lotes.id`, `bitacora.id`, `bitacora.registro_id`, `procesamiento_cafe.id`, `procesamiento_cafe.lote_origen_id/lote_destino_id`, `inventario_movimientos.id`, `inventario_movimientos.lote_id/referencia_id`, `notificaciones.id` son `BIGINT`. Todo lo demás (`proveedores.id`, `clientes.id`, `compras.id`, `ventas.id`, `usuarios.id`, `tenants.id`, etc.) es `INT` normal. Para un script en SQL/Python/Node esto no suele ser un problema real (no se acerca al límite de 32 bits ni con decenas de miles de filas), es más relevante si en algún punto se serializa a JSON con una librería estricta.

---

## 8. Row Level Security — políticas activas (para contexto, no bloquean al script)

Como el script conecta como `postgres` (owner, bypasea RLS — ver sección 2), esto es informativo, no una restricción real para el seed. Útil igual para que quien diseñe el script entienda el modelo de aislamiento por si el script en algún momento prueba leer los datos generados **a través de la API** (ahí sí aplica):

- Casi todas las tablas transaccionales: `tenant_id = fn_current_tenant_id() OR fn_is_super_admin()` (aislamiento estándar por tenant).
- `dispositivos_push`, parte de `notificaciones`: aisladas por `usuario_id = fn_current_usuario_id()`.
- `pagos_tenant`: solo `super_admin` en `ALL`, lectura propia permitida al `admin_bodega` de ese tenant.
- `solicitudes_registro`: `INSERT` público (sin auth), `SELECT`/`UPDATE` solo `super_admin`.
- `tenants`: cada tenant ve solo su propia fila salvo `super_admin`.

`fn_current_tenant_id()`, `fn_current_usuario_id()` y `fn_is_super_admin()` resuelven todo a partir de `auth.uid()` (el UUID del JWT de Supabase) buscando en `usuarios.auth_uid` — por eso cada `usuario_id` real necesita su fila correspondiente en `auth.users` (ver sección 3).

---

## 9. Estado actual real de la base (para no partir de cero a ciegas)

Consultado ahora mismo (conteo de filas):

```
tenants: 1 fila -- id=5, nombre="Bodega de Prueba", estado_id=1 (activo)
usuarios: 5 filas, todos con auth_uid real y login funcional:
  id=3  rol=admin_bodega (2)  tenant_id=5   "Admin Bodega Uno"
  id=7  rol=empleado (3)      tenant_id=5   "Empleado de Prueba"
  id=8  rol=super_admin (1)   tenant_id=NULL "Jafet (super_admin)"
  id=9  rol=super_admin (1)   tenant_id=NULL "Lisaura (super_admin)"
  id=10 rol=super_admin (1)   tenant_id=NULL "Rubiola (super_admin)"
proveedores: 9 filas (tenant 5)
clientes: 7 filas (tenant 5)
compras: 9 / compras_detalle: 9
lotes: 14
ventas: 5 / ventas_detalle: 5
procesamiento_cafe: 5
inventario_movimientos: 21
bitacora: 32
notificaciones: 0
dispositivos_push: 0
pagos_tenant: 0
solicitudes_registro: 1
```

Todo el volumen existente pertenece al único tenant (`id=5`). Los `usuario_id` 3 y 7 son los únicos que pertenecen a ese tenant y pueden "hacer" compras/ventas/procesamiento ahí (los 3 `super_admin` no tienen `tenant_id`, no operan compras/ventas — ver `ForbiddenException` en el código: un `super_admin` sin `tenant_id` no puede registrar compras/ventas/procesamiento).

---

## 10. Decisiones abiertas para quien diseñe el script (no las asumí por vos)

1. **¿Un tenant o varios?** Si querés "varias bodegas" con datos independientes, hay que crear tenants nuevos + al menos un `admin_bodega` con cuenta de Auth real por cada uno (no es gratis, ver sección 3). Si con un tenant alcanza para "varios miles de registros", es mucho más simple: todo bajo `tenant_id=5`.
2. **¿Cuántos usuarios "autores" de las operaciones?** Reusar los 2 existentes del tenant 5 (`usuario_id` 3 y 7) es válido y realista (un empleado y un admin cargando datos), o crear un puñado más (5-10) vía Admin API si se quiere variedad de nombres en la bitácora/reportes.
3. **Volumen y proporciones sugeridas** (no una regla del sistema, solo una guía razonable para que "miles de registros" se vea realista): por cada compra se genera automáticamente 1 lote + 1 bitácora; por cada venta, 1 movimiento de inventario + 1 bitácora; por cada procesamiento, 1 lote + 2 movimientos + 1 bitácora. O sea, generar ~1500-2000 `compras_detalle` y ~1500-2000 `ventas_detalle` ya produce varios miles de filas repartidas naturalmente entre `lotes`, `inventario_movimientos` y `bitacora` sin tener que forzar el conteo en cada tabla por separado.
4. **¿Poblar `notificaciones`, `dispositivos_push`, `pagos_tenant`?** Hoy están vacías. No son necesarias para probar compras/ventas/inventario, pero si el frontend/móvil también quiere ver esas pantallas con datos, avisar — son independientes del resto (no tienen relación funcional con compras/ventas).
5. **¿Fechas?** Todo lo existente es de julio 2026 (fecha actual del proyecto). Si se quiere simular "historial", conviene generar fechas distribuidas en meses anteriores para que reportes por rango (`GET /reportes/ventas?desde&hasta`) y resúmenes (`GET /compras/resumen`, que trae los últimos 30 días agrupados) tengan algo interesante que mostrar en distintos rangos.
6. **¿Registros anulados?** Ver sección 5.5 — opcional, solo si se quiere probar esos flujos específicamente.

---

## 11. Checklist rápido para el script

- [ ] Conectar con `DIRECT_URL` (o `DATABASE_URL`) del `.env` del backend — rol `postgres`, bypasea RLS, no hace falta simular JWT.
- [ ] No insertar en tablas de catálogo (sección 6) — ya están pobladas, solo referenciar sus IDs.
- [ ] No crear miles de `usuarios` — reusar los existentes (sección 9) o crear unos pocos vía Supabase Admin API + `service_role key`.
- [ ] Insertar `compras_detalle` deja que el trigger cree el `lotes` solo — no duplicar ese insert.
- [ ] Para `ventas`, `procesamiento_cafe`, replicar a mano la lógica de saldo/inventario_movimientos/bitácora (sección 5).
- [ ] Respetar los CHECK constraints y las transiciones válidas de procesamiento (sección 7).
- [ ] Todo `tenant_id` consistente con el `usuario_id` que "hace" la operación (no mezclar tenant 5 con un usuario de otro tenant).
