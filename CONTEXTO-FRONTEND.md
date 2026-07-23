# Contexto de la API — Zungo Coffee

Documento de referencia para el equipo de frontend (Ing. Calderón / plataforma web). Resume qué hace la API hoy, qué cambió en la última ronda de trabajo, las tablas de Supabase vigentes, y el detalle de cada endpoint para poder consumirlo sin tener que leer el código NestJS.

---

## 1. Qué es esto

API REST (NestJS + Prisma) para un sistema SaaS multi-tenant de gestión de bodegas de café en Honduras. Cada bodega es un **tenant** aislado (nunca ve datos de otra) mediante Row Level Security de PostgreSQL, reforzado también a nivel de aplicación. La autenticación es 100% Supabase Auth — la API nunca emite ni valida contraseñas directamente, solo verifica el JWT que Supabase ya firmó.

**Roles** (columna `rol_id` en `usuarios`, catálogo `roles`):

| id | rol | qué puede hacer |
|----|-----|------------------|
| 1 | `super_admin` | Dueño de la plataforma: gestiona tenants, pagos/suscripciones, ve bitácora global. No opera compras/ventas. |
| 2 | `admin_bodega` | Dueño de una bodega: control total sobre su propio tenant (inventario, compras, ventas, empleados, anulaciones). |
| 3 | `empleado` | Operativo dentro de una bodega: puede crear/ver compras, ventas, procesamiento; no elimina, no anula, no gestiona usuarios. |

---

## 2. Qué se agregó/arregló en esta ronda de trabajo

Antes de esto, la API ya tenía compras, ventas, lotes, procesamiento, proveedores, clientes, usuarios, tenants, reportes, bitácora, pagos y notificaciones funcionando. Se le agregó:

1. **Captura pública de leads** (`solicitudes`): un formulario en la landing (sin login) puede pedir que le abran una bodega.
2. **Onboarding de bodegas en un solo paso**: antes había que crear el tenant y luego el usuario admin por separado (a mano, con un `authUid` ya existente). Ahora `POST /tenants/onboarding` crea el tenant **y** su primer usuario admin (con email/password reales) en una sola llamada, y opcionalmente marca la solicitud de origen como procesada.
3. **Creación de usuarios con contraseña real**: `POST /usuarios` ya no pide un `authUid` generado a mano — recibe `email` + `password` y crea el usuario directamente en Supabase Auth.
4. **Edición de usuarios y tenants**: `PATCH /usuarios/:id` y `PATCH /tenants/:id`, que no existían.
5. **Endpoint de catálogos** (`GET /catalogos`): un solo request para poblar todos los `<select>` del formulario (variedades, tipos de proveedor/cliente, métodos de pago, niveles de altura, etc.) sin tener que hardcodear listas en el frontend.
6. **Anulación (soft-cancel) de compras, ventas y procesamiento**: antes no existía forma de revertir una operación mal cargada; ahora hay `PATCH /{compras|ventas|procesamiento}/:id/anular`, con las validaciones de negocio correspondientes (ver sección de endpoints).
7. **Ajuste manual de inventario** (`POST /lotes/:id/ajuste`): para correcciones de conteo físico.
8. **Bitácora completa**: proveedores, clientes y procesamiento ahora también quedan auditados (antes solo compras y ventas).
9. **Detalle de compra/venta enriquecido**: `GET /compras/:id` y `GET /ventas/:id` ahora incluyen los lotes involucrados en cada línea, no solo los IDs.
10. **Costo real heredado en procesamiento**: al tostar/moler, el lote derivado ya trae un `costo_unitario` calculado a partir del costo del lote origen (antes quedaba `null`).
11. **Validación de transiciones de estado en procesamiento**: ya no se puede "tostar" una uva ni "moler" un pergamino directamente; solo pergamino→tostado y tostado→molido.
12. **Paginación uniforme**: `lotes`, `procesamiento`, `usuarios` y `notificaciones` ahora aceptan `?page=&pageSize=` igual que `compras`/`ventas`/`bitacora`.
13. **`GET /ventas/resumen`**: no existía el equivalente de `GET /compras/resumen`.
14. **Panel de pagos ampliado**: `GET /pagos/resumen` (KPIs para el super_admin), un campo `estado_calculado` (pagado/vencido/pendiente) en cada pago para pintar en la UI sin tener que calcularlo en el frontend, y el `admin_bodega` ya puede ver el historial de pagos de su propio tenant (antes era solo lectura de super_admin).
15. **`GET/PATCH /perfil`**: para que cualquier usuario logueado consulte/edite su propio nombre sin pasar por el módulo de usuarios.

Todo esto ya está probado contra la base de datos real (37 pruebas automatizadas, incluyendo los casos negativos: anulación rechazada cuando el lote ya tuvo movimiento, transición de estado inválida, saldo insuficiente, etc.).

---

## 3. Cómo autenticarse (importante, léelo antes de integrar)

La API **no tiene endpoint de login**. El flujo es:

1. El frontend llama directamente a Supabase Auth (no a esta API) para iniciar sesión:
   ```
   POST https://tagmxyqqnwttcqisiqvo.supabase.co/auth/v1/token?grant_type=password
   Headers: apikey: <SUPABASE_ANON_KEY>, Content-Type: application/json
   Body: { "email": "...", "password": "..." }
   ```
   Esto devuelve un `access_token` (JWT).
2. Ese JWT se manda en **todas** las peticiones a esta API como `Authorization: Bearer <token>`.
3. La API resuelve automáticamente quién eres (`tenant_id`, `usuario_id`, `rol`) a partir del JWT — **nunca** hay que mandar `tenantId` ni `usuarioId` en el body de ninguna petición, aunque el endpoint lo permita para otros campos. Si lo mandas, se ignora.

**Credenciales que sí puede usar el frontend (públicas por diseño de Supabase):**

```
SUPABASE_URL = https://tagmxyqqnwttcqisiqvo.supabase.co
SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhZ214eXFxbnd0dGNxaXNpcXZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1MTQyNDYsImV4cCI6MjEwMDA5MDI0Nn0.KGV-zluaRwZVKFn0pokzjPBPvYvDNK1dXwi7x2kp1u0
```

**Nunca** debe usarse la `service_role key` en el frontend — esa vive solo en el backend, bypassa toda seguridad (RLS y Auth) y no forma parte de este documento.

Documentación interactiva de todos los endpoints (Swagger): `GET /docs` sobre la URL donde corra la API.

### Credenciales de prueba (staging)

```
Administrador (admin_bodega, tenant "Bodega de Prueba")
correo: admin1@test.com
password: admin123

Empleado (empleado, tenant "Bodega de Prueba")
correo: empleado1@test.com
password: empleado123

Super admin (super_admin, sin tenant -- ve toda la plataforma)
correo: jr@test.com       (Jafet)
correo: lizardc@test.com  (Lisaura)
correo: rubiola@test.com  (Rubiola)
password (los 3): AMOSERZUNGO69
```

Todas verificadas hoy contra `https://zungo-coffee-api.onrender.com`: login por Supabase Auth OK, `GET /perfil` devuelve el rol correcto en cada caso, `empleado` recibe `403` en endpoints exclusivos de `admin_bodega`/`super_admin` (ej. `/tenants`), y los 3 `super_admin` reciben `200` en `GET /tenants` — confirma que el RolesGuard funciona como describe la tabla de roles de la sección 1.

---

## 4. Convenciones que aplican a TODA la API

- **Request bodies en camelCase** (`proveedorId`, `costoUnitario`), **responses en snake_case** (columnas de Postgres tal cual: `proveedor_id`, `costo_unitario`). Es intencional, no una inconsistencia — no esperar que la respuesta venga en camelCase.
- **IDs de tipo BIGINT llegan como string en el JSON**, no como number. Afecta a: `lotes.id`, `bitacora.id`, `procesamiento_cafe.id`, `inventario_movimientos.id`, `notificaciones.id`, y a cualquier campo que los referencie (`loteId`, `lote_id`, etc.). Al mandarlos de vuelta en un request, tanto `123` como `"123"` son aceptados.
- **Paginación**: `?page=1&pageSize=20` (query params, ambos opcionales). Tope duro de `pageSize` en 100 (200 en bitácora, notificaciones default 50). Endpoints paginados: `compras`, `ventas`, `lotes`, `lotes/existencias`, `procesamiento`, `usuarios`, `notificaciones`, `bitacora`.
- **Errores**: formato estándar de NestJS — `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`. Un 403 significa rol no autorizado para ese endpoint; un 400 casi siempre es una regla de negocio (saldo insuficiente, transición inválida, ya anulado, etc.) — el `message` trae el detalle en español, se puede mostrar directo al usuario.
- **Fechas**: `fecha`, `periodo`, `fechaVencimiento` se mandan como string ISO (`"2026-08-01"`) y llegan como datetime ISO completo.
- **Nunca mandar `tenantId`/`usuarioId` propios** en ningún body — se resuelven del JWT, cualquier valor que mandes ahí se ignora silenciosamente (por diseño de seguridad).

---

## 5. Tablas de Supabase (esquema `public`, actualizado)

Todas viven bajo Row Level Security. Se agrupan por capa (igual criterio que usa el propio diseño del sistema):

### 5.1 Catálogos (id SMALLINT, listas fijas — pídelos todos de un jalón con `GET /catalogos` salvo los marcados *)

| Tabla | Uso |
|---|---|
| `roles` | super_admin / admin_bodega / empleado |
| `estados_tenant`* | activo / suspendido |
| `unidades_medida` | galón, quintal, libra |
| `estados_cafe` | uva, humedo, pergamino_seco, tostado_alto/medio/bajo, molido (trae `unidad_medida_id`) |
| `variedades_cafe` | Catuai, Bourbon, Typica, Pacas, Icatu, Lempira, Parainema |
| `niveles_altura` | Estricta / Media / Estándar (con `msnm_min`/`msnm_max`) |
| `proveedores_tipo` | pequeño / mediano / grande |
| `clientes_tipo` | persona_natural / cafeteria_pequena/mediana/grande / distribuidor |
| `metodos_pago` | efectivo / transferencia / cheque |
| `tipos_movimiento_inventario`* | entrada_compra, salida_venta, salida_transformacion, entrada_transformacion, ajuste_positivo, ajuste_negativo |
| `acciones_bitacora`* | INSERT / UPDATE / DELETE |
| `tablas_sistema`* | nombres de tablas auditadas en bitácora |
| `estados_pago`* | pendiente / pagado / vencido |
| `tipos_notificacion`* | tipos de notificación push |
| `plataformas_dispositivo`* | ios / android |
| **`estados_solicitud`** 🆕 | pendiente(1) / procesada(2) / rechazada(3) — de la tabla nueva `solicitudes_registro` |

\* No están en `GET /catalogos` (son de uso más interno/administrativo); si el frontend los necesita, se puede ampliar el endpoint — avisar.

### 5.2 Maestros

| Tabla | Campos clave | Notas |
|---|---|---|
| `tenants` | `nombre`, `estado_id` (1 activo/2 suspendido), `fecha_registro` | Se crea vía `POST /tenants/onboarding` normalmente |
| `usuarios` | `tenant_id` (null para super_admin), `auth_uid` (UUID de Supabase, nunca se expone al frontend), `rol_id`, `nombre`, `estado` | |
| `proveedores` | `nombre`, `sexo` ('M'/'F'), `lugar`, `finca`, `tipo_id`, `telefono`, `estado` | |
| `clientes` | `nombre`, `tipo_id`, `lugar`, `telefono`, `estado` | |

### 5.3 Transaccionales (alto volumen)

| Tabla | Campos clave | Notas |
|---|---|---|
| `compras` | `proveedor_id`, `usuario_id`, `fecha`, `metodo_pago_id`, `total`, **`anulada`** 🆕 | |
| `compras_detalle` | `compra_id`, `estado_cafe_id`, `variedad_id`, `altura_id`, `humedad`, `cantidad`, `costo_unitario` | Cada línea genera un `lotes` automáticamente (trigger de BD) |
| `lotes` | `estado_cafe_id`, `compra_detalle_id`, `lote_origen_id` (si es derivado de un procesamiento), `cantidad_inicial`, `saldo`, `costo_unitario` | Unidad trazable de inventario; `id` es BIGINT (llega como string) |
| `procesamiento_cafe` | `lote_origen_id`, `lote_destino_id`, `cantidad_entrada`, `cantidad_salida`, **`anulado`** 🆕 | Evento de tueste/molido |
| `ventas` | `cliente_id`, `usuario_id`, `fecha`, `metodo_pago_id`, `total`, **`anulada`** 🆕 | |
| `ventas_detalle` | `venta_id`, `lote_id`, `cantidad`, `precio_unitario` | |
| `inventario_movimientos` | `lote_id`, `tipo_movimiento_id`, `cantidad`, `referencia_id` | Ledger genérico de entradas/salidas/ajustes |
| `bitacora` | `usuario_id`, `tabla_afectada_id`, `registro_id`, `accion_id`, `fecha` | Solo lectura e inserción — inmutable, ni el super_admin puede editarla/borrarla |
| **`solicitudes_registro`** 🆕 | `nombre_bodega`, `nombre_contacto`, `email`, `telefono`, `mensaje`, `estado_id`, `tenant_creado_id` | Lead capture público — ver módulo `solicitudes` |
| `pagos_tenant` | `tenant_id`, `periodo`, `monto`, `fecha_vencimiento`, `fecha_pago`, `estado_pago_id` | Solo super_admin gestiona; admin_bodega puede leer las de su tenant |
| `notificaciones` | `usuario_id`, `tipo_id`, `titulo`, `mensaje`, `leida`, `push_enviado` | El envío real de push (FCM/APNs) **todavía no está implementado** — solo se registra el mensaje y el token de dispositivo |
| `dispositivos_push` | `usuario_id`, `token`, `plataforma_id`, `activo` | |

---

## 6. Referencia completa de endpoints

Base URL de staging (Render, plan free): `https://zungo-coffee-api.onrender.com`. Swagger: `https://zungo-coffee-api.onrender.com/docs` (JSON OpenAPI en `/docs-json`). Local: `http://localhost:3000`. Todos requieren `Authorization: Bearer <jwt>` salvo donde se indique "público".

**Nota**: el plan free de Render duerme el servicio tras ~15 min sin tráfico; el primer request después tarda ~30-50s (cold start).

### `auth` / `perfil`

| Método | Ruta | Roles | Body | Notas |
|---|---|---|---|---|
| GET | `/perfil` | cualquiera | — | Devuelve tu propio usuario (`id`, `nombre`, `estado`, `fecha_creacion`, `roles.nombre`, `tenants`) sin `auth_uid` |
| PATCH | `/perfil` | cualquiera | `{ nombre }` | Solo puedes editar tu propio nombre |

### `tenants`

| Método | Ruta | Roles | Body | Notas |
|---|---|---|---|---|
| POST | `/tenants` | super_admin | `{ nombre }` | Crea un tenant sin usuario admin (uso raro; preferir onboarding) |
| POST | `/tenants/onboarding` | super_admin | `{ nombreBodega, emailAdmin, passwordAdmin (min 8), nombreAdmin, solicitudId? }` | Crea tenant + su admin_bodega (con Auth real) en un paso. Devuelve `{ tenant, usuario }`. Si `solicitudId` viene, esa solicitud queda `procesada` y enlazada al tenant nuevo |
| GET | `/tenants` | super_admin | — | Lista con `estados_tenant.nombre` incluido |
| PATCH | `/tenants/:id` | super_admin (cualquiera) / admin_bodega (solo el suyo) | `{ nombre }` | |

### `usuarios`

| Método | Ruta | Roles | Body | Notas |
|---|---|---|---|---|
| POST | `/usuarios` | super_admin, admin_bodega | `{ email, password (min 8), nombre, rolId?, tenantId? }` | admin_bodega: `rolId`/`tenantId` se ignoran, se fuerza empleado en su propio tenant. super_admin: libre |
| GET | `/usuarios` | super_admin, admin_bodega | `?page&pageSize` | super_admin ve todos, admin_bodega solo los de su tenant. Nunca expone `auth_uid` |
| PATCH | `/usuarios/:id` | super_admin, admin_bodega (solo su tenant) | `{ nombre?, estado?, rolId? }` | admin_bodega no puede poner un `rolId` distinto de empleado (403 si lo intenta) |

### `proveedores`

| Método | Ruta | Roles | Body |
|---|---|---|---|
| POST | `/proveedores` | admin_bodega, empleado | `{ nombre, sexo?, lugar?, finca?, tipoId?, telefono? }` |
| GET | `/proveedores` | admin_bodega, empleado | — |
| PATCH | `/proveedores/:id` | admin_bodega | Parcial del body de arriba |

### `clientes`

| Método | Ruta | Roles | Body |
|---|---|---|---|
| POST | `/clientes` | admin_bodega, empleado | `{ nombre, tipoId?, lugar?, telefono? }` |
| GET | `/clientes` | admin_bodega, empleado | — |
| PATCH | `/clientes/:id` | admin_bodega | Parcial del body de arriba |

### `compras`

| Método | Ruta | Roles | Body / Query | Notas |
|---|---|---|---|---|
| POST | `/compras` | admin_bodega, empleado | `{ proveedorId, metodoPagoId?, lineas: [{ estadoCafeId, variedadId?, alturaId?, humedad?, cantidad, costoUnitario }] }` | `estadoCafeId` debe ser 1 (uva), 2 (húmedo) o 3 (pergamino_seco) — son los únicos estados que se compran. Genera un `lotes` por línea automáticamente |
| GET | `/compras/resumen` | admin_bodega | — | Totales por fecha, últimos 30 días |
| GET | `/compras` | admin_bodega, empleado | `?page&pageSize` | |
| GET | `/compras/:id` | admin_bodega, empleado | — | Incluye `compras_detalle` con sus `lotes` generados |
| PATCH | `/compras/:id/anular` | admin_bodega | — | 400 si ya está anulada; 400 si **cualquier** lote generado ya tuvo venta/procesamiento (no se permite anulación parcial) |

### `ventas`

| Método | Ruta | Roles | Body / Query | Notas |
|---|---|---|---|---|
| POST | `/ventas` | admin_bodega, empleado | `{ clienteId, metodoPagoId?, lineas: [{ loteId, cantidad, precioUnitario }] }` | Bloquea el lote (`FOR UPDATE`) antes de descontar saldo — 400 si el saldo es insuficiente |
| GET | `/ventas/resumen` | admin_bodega | — | Totales por fecha, últimos 30 días |
| GET | `/ventas` | admin_bodega, empleado | `?page&pageSize` | |
| GET | `/ventas/:id` | admin_bodega, empleado | — | Incluye `ventas_detalle` con el `lotes` de cada línea |
| PATCH | `/ventas/:id/anular` | admin_bodega | — | Siempre revierte el saldo al lote (no valida su estado posterior); 400 si ya estaba anulada |

### `lotes`

| Método | Ruta | Roles | Body / Query | Notas |
|---|---|---|---|---|
| GET | `/lotes/existencias` | admin_bodega, empleado | `?page&pageSize` | Solo lotes con `saldo > 0`, trae nombre de estado/variedad/altura ya resueltos |
| GET | `/lotes` | admin_bodega, empleado | `?page&pageSize` | Todos los lotes (incluye saldo 0) |
| GET | `/lotes/:id` | admin_bodega, empleado | — | |
| POST | `/lotes/:id/ajuste` | admin_bodega | `{ cantidadAjuste }` (positivo o negativo) | Corrección manual de inventario; 400 si deja el saldo negativo |

### `procesamiento`

| Método | Ruta | Roles | Body / Query | Notas |
|---|---|---|---|---|
| POST | `/procesamiento` | admin_bodega, empleado | `{ loteOrigenId, estadoDestinoId, cantidadEntrada, cantidadSalida }` | Transiciones válidas: pergamino_seco(3)→tostado_alto/medio/bajo(4/5/6), o cualquier tostado(4/5/6)→molido(7). Cualquier otra combinación da 400. Responde `{ ...proceso, lote_destino }` con el `costo_unitario` del nuevo lote ya calculado |
| GET | `/procesamiento` | admin_bodega, empleado | `?page&pageSize` | |
| PATCH | `/procesamiento/:id/anular` | admin_bodega | — | 400 si el lote derivado ya tuvo venta/otro procesamiento, o si ya estaba anulado |

### `catalogos`

| Método | Ruta | Roles | Notas |
|---|---|---|---|
| GET | `/catalogos` | cualquiera | `{ estadosCafe, variedadesCafe, nivelesAltura, proveedoresTipo, clientesTipo, metodosPago, unidadesMedida }` — usar esto para poblar selects, no hardcodear valores |

### `reportes`

| Método | Ruta | Roles | Query |
|---|---|---|---|
| GET | `/reportes/ventas` | admin_bodega, super_admin | `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` |
| GET | `/reportes/compras` | admin_bodega, super_admin | `?desde=&hasta=` |
| GET | `/reportes/inventario` | admin_bodega, super_admin | — (inventario actual, saldo > 0) |

### `bitacora`

| Método | Ruta | Roles | Query | Notas |
|---|---|---|---|---|
| GET | `/bitacora` | super_admin, admin_bodega | `?page&pageSize` (default 50, máx 200) | super_admin ve todo, admin_bodega solo su tenant. Trae `usuarios.nombre`, `tablas_sistema.nombre`, `acciones_bitacora.nombre` ya resueltos |

### `pagos`

| Método | Ruta | Roles | Body | Notas |
|---|---|---|---|---|
| GET | `/pagos/resumen` | super_admin | — | `{ tenantsActivos, tenantsSuspendidos, ingresosMesActual, ingresosTotales }` |
| POST | `/pagos` | super_admin | `{ tenantId, periodo, monto, fechaVencimiento }` | Registra un ciclo de cobro |
| PATCH | `/pagos/:id/marcar-pagado` | super_admin | — | |
| GET | `/pagos/tenant/:tenantId` | super_admin (cualquiera) / admin_bodega (solo el suyo, 403 si pide otro) | — | Cada fila trae `estado_calculado`: `'pagado'` / `'vencido'` / `'pendiente'` — **no persistido**, solo para pintar en UI |
| PATCH | `/pagos/tenant/:tenantId/suspender` | super_admin | — | |
| PATCH | `/pagos/tenant/:tenantId/activar` | super_admin | — | |

### `notificaciones`

| Método | Ruta | Roles | Body / Query | Notas |
|---|---|---|---|---|
| GET | `/notificaciones` | cualquiera | `?page&pageSize` (default 50) | Notificaciones propias + las del tenant sin `usuario_id` específico |
| PATCH | `/notificaciones/:id/leida` | cualquiera | — | Marca como leída (solo si es tuya) |
| POST | `/notificaciones/dispositivos` | cualquiera | `{ token, plataformaId }` (1 ios, 2 android) | Registro de token para push — el envío real **aún no está implementado** |

### `solicitudes`

| Método | Ruta | Roles | Body | Notas |
|---|---|---|---|---|
| POST | `/solicitudes` | **público, sin token** | `{ nombreBodega, nombreContacto, email, telefono?, mensaje? }` | Lead capture desde la landing pública. Único endpoint de toda la API sin autenticación |
| GET | `/solicitudes` | super_admin | — | Pendientes primero |

---

## 7. Pendientes conocidos (no bloquean, pero conviene que Calderón lo sepa)

- **Envío real de push notifications**: se guarda el mensaje y el token de dispositivo, pero no hay integración con Firebase Cloud Messaging / APNs todavía.
- **Automatización de vencimientos de pago**: hoy `estado_calculado` se calcula al leer, pero no hay un job que notifique proactivamente cuando un pago está por vencer.
- **CORS abierto a cualquier origen** en el backend por ahora (`app.enableCors()` sin restricciones) — cuando se defina el dominio de producción del panel web, probablemente haya que restringirlo, pero no afecta el desarrollo local.
- **Staging ya desplegado en Render** (`https://zungo-coffee-api.onrender.com`, ver sección 6) — pero es plan free, con cold start, y no hay ambiente de producción separado todavía.
