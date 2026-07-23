# Contexto completo — App móvil Zungo Coffee (Flutter)

Documento de referencia para el desarrollo de la aplicación móvil. Está escrito asumiendo que quien lo lee (developer o su asistente de código) **no conoce nada del proyecto todavía** — explica el negocio, la arquitectura, la autenticación, cada endpoint y las particularidades de integrarlo desde Flutter/Dart.

---

## 1. Qué es este sistema y qué rol juega la app móvil

Zungo Coffee es un sistema SaaS multi-tenant para bodegas que compran café a productores y lo revenden, ya sea sin procesar o después de tostarlo/molerlo. Cada bodega (**tenant**) es un cliente independiente de la plataforma y nunca ve datos de otra bodega.

Hay dos clientes para la misma API REST:
- **Panel web** (Next.js): lo usa principalmente el dueño de la bodega (`admin_bodega`) y el dueño de la plataforma (`super_admin`) para administración, reportes y configuración.
- **App móvil (Flutter)** — **la que vas a construir**: pensada para la **operación diaria en campo**. Los usuarios típicos son `empleado` y `admin_bodega` registrando compras a productores y ventas a clientes desde el celular, muchas veces literalmente parados en la finca o en la bodega.

**Importante para priorizar pantallas**: las funciones de `super_admin` (gestión de tenants, pagos/suscripciones de la plataforma) casi seguro **no** son parte de la app móvil — esas viven en el panel web. La app móvil se enfoca en: login, catálogo de proveedores/clientes, registrar compras, ver existencias de inventario, registrar ventas, procesar (tostar/moler), notificaciones y perfil.

---

## 2. El negocio: cómo funciona una bodega de café (léelo antes de diseñar pantallas)

### 2.1 Ciclo de vida del producto

El café **cambia de unidad de medida y de identidad** según la etapa en la que está. Esto es la pieza más importante para entender el modelo de datos y por qué los formularios piden lo que piden:

| Etapa | Estado del café | Unidad | ¿Se compra? | ¿Se vende? |
|---|---|---|---|---|
| 1 | Uva (fruta fresca recién cortada) | Galón | Sí | No |
| 2 | Húmedo (pergamino sin secar) | Quintal | Sí | No |
| 3 | Pergamino seco | Quintal | Sí | Sí |
| 4 | Tostado (alto / medio / bajo) | Libra | No | Sí |
| 5 | Molido | Libra | No | Sí |

- Cuando se **compra** café (uva, húmedo o pergamino seco), el bodeguero mide la **humedad** con un higrómetro y anota la **altura** de la finca de origen (dato que da el productor). Estos dos datos, junto con la negociación directa entre el dueño de la bodega y el productor, determinan el precio — **la app nunca calcula el precio**, solo registra lo que el usuario ingresa como `costoUnitario`.
- La altura de cultivo se clasifica en tres niveles: **Estricta** (>1350 msnm), **Media** (1200–1350 msnm), **Estándar** (<1200 msnm).
- Cuando se **procesa** (tuesta o muele) un lote, el sistema no modifica el lote original — crea uno nuevo derivado, para poder rastrear de dónde salió cada libra vendida hasta la compra y el proveedor original. El tueste sí reduce el peso real (merma de humedad); el molido casi no cambia el peso. Por eso el formulario de procesamiento pide tanto la cantidad que entra como la que sale — el sistema calcula el rendimiento real, no usa un factor fijo estimado.
- **Reglas de transición válidas**: solo se puede tostar un pergamino seco (nunca una uva o un húmedo directamente), y solo se puede moler algo que ya esté tostado. Cualquier otra combinación la API la rechaza.

### 2.2 Roles de usuario

| Rol | Qué hace | ¿Usa la app móvil? |
|---|---|---|
| `super_admin` | Dueño de la plataforma. Gestiona todas las bodegas y sus pagos. | No (panel web) |
| `admin_bodega` | Dueño de una bodega. Control total de su bodega: inventario, compras, ventas, empleados, puede anular operaciones. | Sí |
| `empleado` | Trabajador de campo. Puede crear y ver compras/ventas/procesamiento, pero no elimina, no anula, no gestiona usuarios. | Sí (es el usuario principal de la app) |

### 2.3 El flujo típico que un empleado hace en la app, de principio a fin

1. Abre la app, inicia sesión.
2. Llega un productor a vender café → si no está registrado, lo crea (`proveedores`).
3. Registra la **compra**: elige el proveedor, mide humedad y altura, anota cantidad y precio acordado → esto genera automáticamente un **lote** de inventario (el usuario no crea el lote directamente, es un efecto de registrar la compra).
4. En algún momento se decide tostar o moler parte del inventario → registra un **procesamiento**, eligiendo el lote origen y cuánto entra/sale. Esto crea un lote nuevo (derivado).
5. Llega un cliente a comprar café ya listo → el empleado consulta **existencias** (qué lotes tienen saldo disponible), elige uno, registra la **venta**.
6. Si el saldo del lote no alcanza, la API rechaza la venta con un error claro — hay que mostrarlo al usuario, no es un bug.
7. El usuario puede recibir **notificaciones** (avisos del sistema) y debe registrar su dispositivo para push la primera vez que abre la app o da permisos.

---

## 3. Arquitectura (lo mínimo que necesitas saber)

- Backend: NestJS + Prisma sobre PostgreSQL (Supabase).
- Multi-tenant: cada fila de negocio tiene un `tenant_id` invisible para ti — la API lo resuelve sola a partir de quién hizo login. **Nunca** hay que mandar `tenantId` en ningún body.
- Seguridad: Row Level Security a nivel de base de datos + verificación de rol en la API. Si tu usuario no tiene permiso para un endpoint, la API responde `403`, no un error genérico.
- La API expone documentación interactiva (Swagger) en `GET /docs` sobre la URL donde esté corriendo — útil para probar un endpoint a mano antes de integrarlo en Dart.

---

## 4. Autenticación (Supabase Auth) — cómo hacerlo desde Flutter

La API **no tiene endpoint de login propio**. La identidad se maneja 100% con Supabase Auth:

1. Tu app llama directamente a Supabase (no a la API de NestJS) para iniciar sesión.
2. Supabase te devuelve un JWT (`access_token`).
3. Ese JWT se manda en `Authorization: Bearer <token>` en **cada** llamada a la API de Zungo Coffee.

**Credenciales públicas que la app necesita** (esto sí es seguro embeberlo en la app, es el diseño de Supabase — el `anon key` está pensado para vivir en clientes):

```
SUPABASE_URL = https://tagmxyqqnwttcqisiqvo.supabase.co
SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhZ214eXFxbnd0dGNxaXNpcXZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1MTQyNDYsImV4cCI6MjEwMDA5MDI0Nn0.KGV-zluaRwZVKFn0pokzjPBPvYvDNK1dXwi7x2kp1u0
```

### Cómo integrarlo en Flutter

La forma más simple es usar el paquete oficial `supabase_flutter` (maneja login, refresh de sesión y guardado seguro del token automáticamente):

```yaml
# pubspec.yaml
dependencies:
  supabase_flutter: ^2.0.0
```

```dart
// Inicializar una vez, en main()
await Supabase.initialize(
  url: 'https://tagmxyqqnwttcqisiqvo.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIs...', // el anon key de arriba
);

// Login
final response = await Supabase.instance.client.auth.signInWithPassword(
  email: email,
  password: password,
);
final jwt = response.session?.accessToken;

// Ese jwt se manda en cada llamada a la API de NestJS:
final res = await http.get(
  Uri.parse('https://<host-de-la-api>/lotes/existencias'),
  headers: {'Authorization': 'Bearer $jwt', 'Content-Type': 'application/json'},
);
```

`supabase_flutter` refresca el token solo cuando expira, y `Supabase.instance.client.auth.currentSession` te da la sesión activa en cualquier momento — conviene leer el `accessToken` de ahí en un interceptor central en vez de guardarlo tú mismo en una variable estática, para no mandar un token vencido.

Si prefieres no traer la dependencia de Supabase y hacerlo con `http`/`dio` puro, el login es una llamada REST directa:

```
POST https://tagmxyqqnwttcqisiqvo.supabase.co/auth/v1/token?grant_type=password
Headers: apikey: <SUPABASE_ANON_KEY>, Content-Type: application/json
Body: { "email": "...", "password": "..." }
→ devuelve { "access_token": "...", "refresh_token": "...", "expires_in": ... }
```

Para refrescar antes de que expire: `POST .../auth/v1/token?grant_type=refresh_token` con `{ "refresh_token": "..." }`.

**Nunca** debe existir en la app la `service_role key` de Supabase — esa key bypassa toda la seguridad y vive únicamente en el backend. Si en algún momento ves ese nombre en un `.env` o config, no es para el móvil.

### Credenciales de prueba (staging, tenant "Bodega de Prueba")

```
Administrador (admin_bodega)
correo: admin1@test.com
password: admin123

Empleado (empleado)
correo: empleado1@test.com
password: empleado123
```

Ambas verificadas hoy contra `https://zungo-coffee-api.onrender.com`: login por Supabase Auth OK, `GET /perfil` devuelve el rol correcto en cada caso, y el usuario `empleado` recibe `403` en endpoints exclusivos de `admin_bodega`/`super_admin` (ej. `/tenants`) — el RolesGuard funciona como se documenta en la sección 2.2.

---

## 5. Convenciones que aplican a TODA la API (léelas antes de generar los modelos Dart)

- **Request bodies en camelCase** (`proveedorId`, `costoUnitario`, `estadoCafeId`), pero las **respuestas vienen en snake_case** (`proveedor_id`, `costo_unitario`, `estado_cafe_id` — son los nombres de columna de Postgres tal cual). No son inconsistentes, es intencional: al mandar datos usas camelCase, al leerlos te llegan en snake_case. Tus modelos Dart de respuesta (`fromJson`) deben usar las claves snake_case.
- **Los IDs BigInt llegan como `String` en el JSON, no como número.** Esto afecta a: `lotes.id`, `bitacora.id`, `procesamiento_cafe.id`, `inventario_movimientos.id`, `notificaciones.id`, y a cualquier campo que los referencie (`loteId` al mandar una venta, por ejemplo). **Esto es crítico en Dart**: si parseas esos campos como `int` vas a tener errores de tipo al deserializar el JSON — decláralos como `String` en tus modelos, y conviértelos a `int`/`BigInt` solo si necesitas hacer aritmética local, nunca para mandarlos de vuelta (mándalos como string o int, ambos son aceptados por la API). El resto de los IDs (`proveedor_id`, `cliente_id`, `tenant_id`, `usuario_id`, etc.) sí son enteros normales (INT), esos sí puedes tratarlos como `int` sin problema.
- **Paginación**: `?page=1&pageSize=20` como query params opcionales. Aplica a: `compras`, `ventas`, `lotes`, `lotes/existencias`, `procesamiento`, `usuarios`, `notificaciones`, `bitacora`. Tope duro de `pageSize` en 100 (200 en bitácora; notificaciones default 50 en vez de 20).
- **Errores**: formato estándar `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`. Un `403` = tu usuario no tiene el rol requerido para ese endpoint. Un `400` casi siempre es una regla de negocio (saldo insuficiente, transición de estado inválida, ya anulado, etc.) y el `message` viene en español listo para mostrarle al usuario tal cual, sin necesidad de traducir códigos.
- **Fechas**: se mandan como string ISO (`"2026-08-01"`) y llegan como datetime ISO completo (`"2026-08-01T00:00:00.000Z"`).
- **Nunca mandes tu propio `tenantId` o `usuarioId`** en ningún body — la API los resuelve del JWT. Si los mandas, se ignoran silenciosamente (por diseño de seguridad, para que nadie pueda hacerse pasar por otro tenant/usuario cambiando un campo del request).

---

## 6. Flujos de negocio paso a paso, con ejemplos de request/response

### 6.1 Login → obtener catálogos (para poblar los dropdowns de los formularios)

Después del login, antes de mostrar el formulario de compra, pide los catálogos una sola vez (cachéalos en memoria/local, no cambian seguido):

```
GET /catalogos
Authorization: Bearer <jwt>

→ 200 OK
{
  "estadosCafe": [ { "id": 1, "nombre": "uva", "unidad_medida_id": 1 }, { "id": 3, "nombre": "pergamino_seco", ... }, ... ],
  "variedadesCafe": [ { "id": 1, "nombre": "Catuai" }, ... ],
  "nivelesAltura": [ { "id": 1, "nombre": "Estandar", "msnm_min": null, "msnm_max": 1200 }, ... ],
  "proveedoresTipo": [ ... ],
  "clientesTipo": [ ... ],
  "metodosPago": [ ... ],
  "unidadesMedida": [ ... ]
}
```

Para el formulario de **compra**, solo son válidos como `estadoCafeId`: `1` (uva), `2` (húmedo) o `3` (pergamino_seco) — filtra la lista de `estadosCafe` que muestras en ese formulario a esos tres, aunque el catálogo completo traiga los 7.

### 6.2 Registrar un proveedor nuevo en campo

```
POST /proveedores
Authorization: Bearer <jwt>
Body: { "nombre": "Don Chepe Martinez", "sexo": "M", "lugar": "Marcala", "finca": "Finca El Roble", "tipoId": 1, "telefono": "9999-9999" }

→ 201 Created
{ "id": 12, "tenant_id": 5, "nombre": "Don Chepe Martinez", "sexo": "M", "lugar": "Marcala", "finca": "Finca El Roble", "tipo_id": 1, "telefono": "9999-9999", "estado": true }
```

### 6.3 Registrar una compra (genera lote automáticamente)

```
POST /compras
Body: {
  "proveedorId": 12,
  "metodoPagoId": 1,
  "lineas": [
    { "estadoCafeId": 3, "variedadId": 1, "alturaId": 1, "humedad": 11.5, "cantidad": 10, "costoUnitario": 120 }
  ]
}

→ 201 Created
{ "id": 45, "tenant_id": 5, "proveedor_id": 12, "usuario_id": 3, "fecha": "...", "total": "1200.00", "anulada": false }
```

Una compra puede tener varias `lineas` (por ejemplo, si el mismo proveedor trae pergamino Y húmedo el mismo día). Cada línea genera un lote por separado. Para ver el lote resultante, hay que consultar existencias después (no viene en la respuesta de `POST /compras`, viene en `GET /compras/:id` con el detalle, o directo en `GET /lotes/existencias`).

### 6.4 Consultar existencias antes de vender

```
GET /lotes/existencias?page=1&pageSize=20
Authorization: Bearer <jwt>

→ 200 OK
[
  {
    "id": "78",
    "saldo": "10.00",
    "cantidad_inicial": "10.00",
    "estados_cafe": { "nombre": "pergamino_seco", "unidad_medida_id": 2 },
    "variedades_cafe": { "nombre": "Catuai" },
    "niveles_altura": { "nombre": "Estandar" }
  }
]
```

Nota el `"id": "78"` como **string** — es el `loteId` que vas a mandar en la venta.

### 6.5 Registrar una venta

```
POST /ventas
Body: {
  "clienteId": 7,
  "metodoPagoId": 1,
  "lineas": [ { "loteId": 78, "cantidad": 5, "precioUnitario": 150 } ]
}

→ 201 Created  (si hay saldo suficiente)
{ "id": 30, "tenant_id": 5, "cliente_id": 7, "usuario_id": 3, "total": "750.00", "anulada": false }

→ 400 Bad Request  (si NO hay saldo suficiente)
{ "statusCode": 400, "message": "Saldo insuficiente en lote 78", "error": "Bad Request" }
```

`loteId` acepta tanto `78` (número) como `"78"` (string) — igual funciona, manda lo que te resulte más natural en Dart.

### 6.6 Procesar café (tostar/moler)

```
POST /procesamiento
Body: { "loteOrigenId": 78, "estadoDestinoId": 5, "cantidadEntrada": 5, "cantidadSalida": 350 }

→ 201 Created
{ "id": "9", "tenant_id": 5, "lote_origen_id": "78", "lote_destino_id": "80", "cantidad_entrada": "5.00", "cantidad_salida": "350.00",
  "lote_destino": { "id": "80", "saldo": "350.00", "cantidad_inicial": "350.00", "costo_unitario": "1.71", ... } }

→ 400 Bad Request  (si la transición de estado no es válida, ej. intentar moler un pergamino directamente)
{ "statusCode": 400, "message": "Transición de estado no permitida para este lote", "error": "Bad Request" }
```

`estadoDestinoId`: `4`/`5`/`6` = tostado alto/medio/bajo (solo válido si el lote origen está en pergamino_seco=3), `7` = molido (solo válido si el origen ya está tostado).

### 6.7 Notificaciones y registro de push

```
GET /notificaciones?page=1&pageSize=50
→ 200 OK  [ { "id": "3", "titulo": "...", "mensaje": "...", "leida": false, ... }, ... ]

PATCH /notificaciones/3/leida
→ 200 OK

POST /notificaciones/dispositivos
Body: { "token": "<token de Firebase Cloud Messaging>", "plataformaId": 2 }   // 1 = ios, 2 = android
→ 201 Created
```

Registra el dispositivo (usando Firebase Messaging en Flutter para obtener el token) la primera vez que el usuario abre la app o acepta permisos de notificación, y también si el token de FCM cambia (Firebase lo rota de vez en cuando — escucha `FirebaseMessaging.instance.onTokenRefresh` y vuelve a llamar este endpoint).

**Importante**: por ahora el backend **solo guarda** el token y el mensaje — el envío real de la notificación push (FCM/APNs) todavía no está conectado del lado del servidor. Es decir, el endpoint de listar notificaciones (`GET /notificaciones`) sí funciona hoy para mostrar una bandeja de notificaciones dentro de la app, pero no esperes que lleguen push nativas al teléfono todavía.

### 6.8 Perfil del usuario logueado

```
GET /perfil
→ 200 OK
{ "id": 3, "nombre": "Admin Bodega Uno", "estado": true, "fecha_creacion": "...",
  "roles": { "nombre": "admin_bodega" }, "tenants": { "id": 5, "nombre": "Bodega de Prueba" } }

PATCH /perfil
Body: { "nombre": "Nuevo Nombre" }
→ 200 OK
```

---

## 7. Referencia completa de endpoints

Base URL de staging (Render, plan free): `https://zungo-coffee-api.onrender.com`. Swagger interactivo: `https://zungo-coffee-api.onrender.com/docs` (JSON OpenAPI en `/docs-json`). Para desarrollo local seguís usando `http://localhost:3000`. Todos los endpoints requieren `Authorization: Bearer <jwt>` salvo `POST /solicitudes`.

**Nota sobre el plan free de Render**: el servicio se duerme tras ~15 min sin tráfico; el primer request después de eso tarda ~30-50s en responder (cold start) — no es un bug ni un timeout de tu lado.

| Módulo | Método | Ruta | Roles | Body / Query |
|---|---|---|---|---|
| perfil | GET | `/perfil` | cualquiera | — |
| perfil | PATCH | `/perfil` | cualquiera | `{ nombre }` |
| proveedores | POST | `/proveedores` | admin_bodega, empleado | `{ nombre, sexo?, lugar?, finca?, tipoId?, telefono? }` |
| proveedores | GET | `/proveedores` | admin_bodega, empleado | — |
| proveedores | PATCH | `/proveedores/:id` | admin_bodega | parcial del body de arriba |
| clientes | POST | `/clientes` | admin_bodega, empleado | `{ nombre, tipoId?, lugar?, telefono? }` |
| clientes | GET | `/clientes` | admin_bodega, empleado | — |
| clientes | PATCH | `/clientes/:id` | admin_bodega | parcial |
| compras | POST | `/compras` | admin_bodega, empleado | `{ proveedorId, metodoPagoId?, lineas: [{ estadoCafeId, variedadId?, alturaId?, humedad?, cantidad, costoUnitario }] }` |
| compras | GET | `/compras/resumen` | admin_bodega | — (totales por fecha, 30 días) |
| compras | GET | `/compras` | admin_bodega, empleado | `?page&pageSize` |
| compras | GET | `/compras/:id` | admin_bodega, empleado | incluye lotes generados |
| compras | PATCH | `/compras/:id/anular` | admin_bodega | 400 si algún lote ya se movió |
| ventas | POST | `/ventas` | admin_bodega, empleado | `{ clienteId, metodoPagoId?, lineas: [{ loteId, cantidad, precioUnitario }] }` |
| ventas | GET | `/ventas/resumen` | admin_bodega | — |
| ventas | GET | `/ventas` | admin_bodega, empleado | `?page&pageSize` |
| ventas | GET | `/ventas/:id` | admin_bodega, empleado | incluye lote de cada línea |
| ventas | PATCH | `/ventas/:id/anular` | admin_bodega | siempre revierte saldo |
| lotes | GET | `/lotes/existencias` | admin_bodega, empleado | `?page&pageSize` — solo saldo > 0 |
| lotes | GET | `/lotes` | admin_bodega, empleado | `?page&pageSize` — todos |
| lotes | GET | `/lotes/:id` | admin_bodega, empleado | — |
| lotes | POST | `/lotes/:id/ajuste` | admin_bodega | `{ cantidadAjuste }` (+/-) |
| procesamiento | POST | `/procesamiento` | admin_bodega, empleado | `{ loteOrigenId, estadoDestinoId, cantidadEntrada, cantidadSalida }` |
| procesamiento | GET | `/procesamiento` | admin_bodega, empleado | `?page&pageSize` |
| procesamiento | PATCH | `/procesamiento/:id/anular` | admin_bodega | 400 si el lote derivado ya se movió |
| catalogos | GET | `/catalogos` | cualquiera | — |
| reportes | GET | `/reportes/ventas` | admin_bodega, super_admin | `?desde&hasta` |
| reportes | GET | `/reportes/compras` | admin_bodega, super_admin | `?desde&hasta` |
| reportes | GET | `/reportes/inventario` | admin_bodega, super_admin | — |
| bitacora | GET | `/bitacora` | super_admin, admin_bodega | `?page&pageSize` (probablemente no aplica al móvil) |
| notificaciones | GET | `/notificaciones` | cualquiera | `?page&pageSize` |
| notificaciones | PATCH | `/notificaciones/:id/leida` | cualquiera | — |
| notificaciones | POST | `/notificaciones/dispositivos` | cualquiera | `{ token, plataformaId }` |
| usuarios | POST | `/usuarios` | super_admin, admin_bodega | `{ email, password, nombre, rolId?, tenantId? }` (probablemente no aplica al móvil) |
| usuarios | GET | `/usuarios` | super_admin, admin_bodega | `?page&pageSize` |
| usuarios | PATCH | `/usuarios/:id` | super_admin, admin_bodega | `{ nombre?, estado?, rolId? }` |
| tenants, pagos, solicitudes | — | — | super_admin | Son del panel web administrativo — casi seguro no aplican a la app móvil |

---

## 8. Tablas de la base de datos (para entender qué datos vas a mostrar/mandar)

### Catálogos (listas fijas — pídelas todas con `GET /catalogos`)
`estados_cafe` (uva/húmedo/pergamino_seco/tostado ×3/molido), `variedades_cafe` (Catuai, Bourbon, Typica, Pacas, Icatu, Lempira, Parainema), `niveles_altura` (Estricta/Media/Estándar, con rangos msnm), `proveedores_tipo` (pequeño/mediano/grande), `clientes_tipo` (persona_natural/cafeteria pequeña·mediana·grande/distribuidor), `metodos_pago` (efectivo/transferencia/cheque), `unidades_medida` (galón/quintal/libra).

### Maestros
- `proveedores`: `nombre`, `sexo` ('M'/'F'), `lugar`, `finca`, `tipo_id`, `telefono`, `estado`.
- `clientes`: `nombre`, `tipo_id`, `lugar`, `telefono`, `estado`.
- `usuarios`: tu propio registro se consulta con `GET /perfil`, no necesitas manipular esta tabla directo salvo que construyas pantallas de admin.

### Transaccionales (lo que la app crea constantemente)
- `compras` / `compras_detalle`: cabecera + líneas de cada compra.
- `lotes`: la unidad de inventario — de aquí sale todo lo que se puede vender o procesar. `id` es BigInt (string en JSON).
- `procesamiento_cafe`: eventos de tueste/molido.
- `ventas` / `ventas_detalle`: cabecera + líneas de cada venta.
- `notificaciones` / `dispositivos_push`: bandeja de avisos y tokens de push registrados.

---

## 9. Consideraciones específicas de Flutter/Dart

1. **Modelos con `json_serializable` o `freezed`**: declara los campos BigInt (`id` de lotes/procesamiento/notificaciones/bitácora) como `String`, no `int`. El resto de los IDs sí son `int`.
2. **Cliente HTTP centralizado**: usa `dio` con un interceptor que agregue automáticamente `Authorization: Bearer <token actual>` leyendo la sesión de `supabase_flutter`, y que redirija al login si un request da `401` (sesión vencida y no se pudo refrescar).
3. **Decimales**: campos como `saldo`, `total`, `costoUnitario`, `precioUnitario` llegan como string con formato `"123.45"` (Prisma Decimal serializado) — parsea con `double.parse()` o usa un paquete de decimal si te preocupa precisión de dinero; no asumas que vienen como `number` JSON.
4. **Validación de formularios**: replica en el cliente al menos las validaciones obvias antes de golpear la API (cantidad positiva, campos requeridos), pero **la fuente de verdad de las reglas de negocio (saldo suficiente, transición de estado válida, etc.) es siempre la API** — maneja el `400` con su `message` como el camino esperado, no como un caso excepcional raro.
5. **Trabajo en campo / conectividad**: dado que esta app se usa en fincas y bodegas donde la señal puede ser irregular, vale la pena diseñar la capa de red pensando en reintentos y, si el proyecto lo requiere, una cola local de operaciones pendientes — eso es una decisión de arquitectura de la app, no algo que la API resuelva por ti.
6. **Push notifications**: usa `firebase_messaging` para obtener el token FCM y mándalo a `POST /notificaciones/dispositivos` con `plataformaId: 1` (iOS) o `2` (Android). Como el envío real del lado del servidor aún no está implementado, no vas a poder probar una push nativa llegando todavía — sí puedes construir y probar la bandeja de notificaciones in-app contra `GET /notificaciones`.

---

## 10. Pendientes conocidos del backend (para que no se interpreten como bugs de la app)

- El envío real de push (FCM/APNs) no está conectado del lado del servidor todavía — solo se registra el token.
- CORS del backend está abierto sin restricciones por ahora (no afecta a la app móvil, es un tema del panel web).
- No hay ambiente de producción separado todavía — `https://zungo-coffee-api.onrender.com` es staging (plan free, con cold start), no producción.
