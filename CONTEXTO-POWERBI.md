# Contexto completo — Dashboards Power BI (Zungo Coffee)

Documento de referencia para conectar Power BI a la base de datos real de Zungo Coffee y construir los dashboards, KPIs y mapas. Escrito asumiendo que quien lo lee no conoce nada del proyecto todavía.

---

## 1. Qué es esto

Zungo Coffee es un sistema multi-tenant para bodegas de café en Honduras: compran café a productores, opcionalmente lo procesan (tuestan/muelen), y lo revenden. Hay **12 bodegas (tenants)** con datos poblados — 2 grandes, 4 medianas, 6 chicas — repartidas en distintos departamentos del país, con **~1.05 millones de registros transaccionales** distribuidos en 3 años de historial (julio 2023 – julio 2026), con estacionalidad real de cosecha (pico noviembre–marzo).

A diferencia del panel web y la app móvil (que consumen la API REST), **Power BI se conecta directo a la base de datos Postgres** — no a la API. Esto es más simple para BI: los tipos de dato (BigInt, Decimal, fechas) llegan nativos por el protocolo de Postgres, sin la conversión a string que sí aplica en las respuestas JSON de la API (ver `CONTEXTO-FRONTEND.md` si te interesa esa diferencia).

---

## 2. Conexión — datos para Power BI

**Conector:** Power BI Desktop → *Obtener datos* → *Base de datos* → **PostgreSQL database**.

```
Servidor:    aws-1-us-west-2.pooler.supabase.com:5432
Base de datos: postgres
Usuario:     powerbi_readonly.tagmxyqqnwttcqisiqvo
Contraseña:  <pedisela a Carlos por fuera de este repo -- este es un repo publico, no va la contraseña acá>
```

**Importante sobre el usuario:** no es la cuenta del backend — es un rol nuevo creado específicamente para esto, de **solo lectura** (verificado: puede hacer `SELECT` sobre las 12 bodegas, pero un `INSERT` de prueba fue rechazado con "permission denied"). Tampoco puede ver el esquema `auth` (usuarios/contraseñas de Supabase Auth) — solo el esquema `public`, que es donde vive todo el negocio.

**Modo de conexión recomendado:** *Import*, no *DirectQuery*. Con ~1M filas Import es rápido de cargar (unos minutos) y las visualizaciones responden instantáneo — DirectQuery estaría pegándole a la base en vivo en cada clic, y esto corre en el free tier de Supabase (recursos compartidos, sin necesidad de esa carga constante). Si hace falta refrescar con datos nuevos más adelante, usar *Refresh* programado en Power BI Service, no DirectQuery.

**Modo de autenticación en el conector:** *Database* (usuario/contraseña), no Windows ni OAuth.

---

## 3. Modelo de datos — qué tablas usar y cómo se relacionan

### 3.1 Tablas de hechos (fact tables) — donde está el volumen

| Tabla | Qué mide | Grano |
|---|---|---|
| `compras_detalle` | Compras a proveedores | 1 fila = 1 línea de una compra (café + cantidad + costo) |
| `ventas_detalle` | Ventas a clientes | 1 fila = 1 línea de una venta (lote vendido + cantidad + precio) |
| `procesamiento_cafe` | Eventos de tueste/molido | 1 fila = 1 transformación (lote origen → lote destino) |
| `inventario_movimientos` | Ledger de entradas/salidas de inventario | 1 fila = 1 movimiento (venta, transformación, ajuste) |
| `bitacora` | Auditoría — quién hizo qué y cuándo | 1 fila = 1 acción (alta de compra/venta/proveedor/cliente/procesamiento) |

### 3.2 Tablas de dimensión

| Tabla | Para qué sirve |
|---|---|
| `tenants` | Las 12 bodegas (dimensión principal para comparar entre bodegas) |
| `usuarios` | Quién ejecuta cada operación (empleado/admin_bodega) |
| `proveedores` | Productores — tiene `lugar` (pueblo/departamento) y `tipo_id` (pequeño/mediano/grande) |
| `clientes` | Compradores — tiene `lugar` y `tipo_id` (persona_natural/cafetería.../distribuidor) |
| `lotes` | El inventario en sí — cada lote nace de una compra o de un procesamiento, nunca de ambos |
| `compras`, `ventas` | Cabeceras (fecha, total, proveedor/cliente, si está anulada) |

### 3.3 Catálogos (dimensiones chicas, para nombres legibles en vez de IDs)

`estados_cafe` (uva/húmedo/pergamino_seco/tostado ×3/molido), `variedades_cafe` (9 variedades — incluye 2 agregadas para este dataset: IHCAFE-90 y Villa Sarchi), `niveles_altura` (Estricta/Media/Estándar), `proveedores_tipo`, `clientes_tipo`, `metodos_pago`.

### 3.4 Relaciones clave para armar el modelo en Power BI

```
compras_detalle.compra_id      -> compras.id
compras_detalle.tenant_id      -> tenants.id
compras_detalle.variedad_id    -> variedades_cafe.id
compras_detalle.altura_id      -> niveles_altura.id
compras_detalle.estado_cafe_id -> estados_cafe.id

lotes.compra_detalle_id  -> compras_detalle.id   (si nacio de una compra)
lotes.lote_origen_id     -> lotes.id              (si nacio de un procesamiento -- self join)

ventas_detalle.lote_id   -> lotes.id     (¡clave para margen! ver seccion 5.2)
ventas_detalle.venta_id  -> ventas.id

procesamiento_cafe.lote_origen_id  -> lotes.id
procesamiento_cafe.lote_destino_id -> lotes.id

compras.proveedor_id -> proveedores.id
ventas.cliente_id    -> clientes.id
```

---

## 4. Reglas de negocio que hay que respetar para que los KPIs no mientan

- **Filtrar anuladas**: `compras.anulada`, `ventas.anulada`, `procesamiento_cafe.anulado` — para KPIs de "actividad real" (ventas totales, ingresos, etc.) filtrar `WHERE anulada = false`. Para un dashboard específico de cancelaciones, usarlas a propósito. En este dataset no hay anuladas (se decidió no generarlas para el seed), pero la columna existe y el panel web sí las usa en producción, así que el filtro es buena práctica igual.
- **`lotes.saldo` vs `lotes.cantidad_inicial`**: saldo es lo que queda disponible ahora mismo (inventario actual); cantidad_inicial es lo que entró originalmente. Para "inventario actual" usar `saldo`. Para "todo lo que se compró/produjo" usar `cantidad_inicial`.
- **Nunca sumar `compras.total` + `ventas.total` directo como "actividad"** — son unidades de negocio distintas (compra en quintales/galones a proveedor, venta en quintales/libras a cliente), sumarlos junto no da un número con sentido de negocio real. Tratarlos como dos métricas separadas.
- **IDs de tipo bigint** (`lotes.id`, `bitacora.id`, `procesamiento_cafe.id`, `inventario_movimientos.id`) llegan bien como número entero via el conector de Postgres — a diferencia de la API REST, acá no hace falta ningún manejo especial.
- **Todos los importes son Lempiras (L.)**, sin conversión de moneda.
- **Rango de fechas real de los datos**: julio 2023 – julio 2026, con **pico de compras noviembre–marzo** (temporada de cosecha) y un mínimo notorio mayo–octubre. Cualquier gráfico de tendencia mensual va a mostrar esa estacionalidad — es real y esperado, no un bug de los datos.

---

## 5. Ideas concretas de dashboards, KPIs y gráficos

### 5.1 Panel general (todas las bodegas)

- **Tendencia mensual de compras y ventas** (línea, eje X = mes, dos series) — va a mostrar claramente el pico ene-mar.
- **Ranking de bodegas por volumen** (barras horizontales, `SUM(compras_detalle.cantidad)` o `SUM(ventas_detalle.cantidad * precio_unitario)` agrupado por `tenants.nombre`) — las 2 grandes deberían destacarse claramente sobre las 6 chicas.
- **Mix de variedades compradas** (dona/barras, `COUNT`/`SUM(cantidad)` agrupado por `variedades_cafe.nombre`) — IHCAFE-90 y Parainema van a ser las más frecuentes (son las de mayor peso en la generación).
- **Distribución de altura de cultivo** (Estricta/Media/Estándar) — barras o dona.

### 5.2 Rentabilidad (el KPI más valioso que se puede sacar de este modelo)

`ventas_detalle.lote_id` conecta directo con `lotes.costo_unitario` — eso permite calcular **margen real por línea de venta**:

```
margen_linea = ventas_detalle.cantidad * (ventas_detalle.precio_unitario - lotes.costo_unitario)
```

Como medida DAX (aproximada):
```
Margen = SUMX(ventas_detalle, ventas_detalle[cantidad] * (ventas_detalle[precio_unitario] - RELATED(lotes[costo_unitario])))
```
Ojo: `lotes.costo_unitario` puede ser `NULL` en algunos lotes derivados de procesamiento si el lote origen no tenía costo (caso raro) — usar `COALESCE(costo_unitario, 0)` o filtrar esos casos si aparecen en blanco.

Con esto se puede armar: margen por bodega, margen por variedad, margen por nivel de tueste, evolución del margen en el tiempo.

### 5.3 Procesamiento / rendimiento de producción

- **Rendimiento de tueste**: `procesamiento_cafe.cantidad_salida / procesamiento_cafe.cantidad_entrada` (recordar que entra en quintales y sale en libras — 1 quintal = 100 libras, así que un rendimiento "normal" ronda 60-65 al convertir, no un ratio 1:1). Compararlo por nivel de tueste (`lotes.estado_cafe_id` del destino: alto/medio/bajo).
- **Segunda transformación (molido)**: filtrar `procesamiento_cafe` donde el lote origen tiene `estado_cafe_id` tostado, para ver qué porción del tostado se muele.

### 5.4 Segmentación de clientes

- **Ventas por tipo de cliente** (persona_natural / cafetería pequeña·mediana·grande / distribuidor) — dona o barras apiladas. El volumen (libras/quintales) de un distribuidor va a ser órdenes de magnitud mayor que el de una persona natural aunque haya muchos menos distribuidores — buen gráfico de "pocos clientes, mucho volumen" vs "muchos clientes, poco volumen cada uno".
- **Ticket promedio por tipo de cliente** (`AVG(ventas.total)` agrupado por `clientes_tipo`).

### 5.5 Mapas — ya hay datos de ubicación reales

`proveedores.lugar` y `clientes.lugar` tienen pueblos/departamentos/ciudades reales de Honduras (los rellené para este dataset — antes estaban vacíos). Para el visual de **Mapa** o **ArcGIS Maps** de Power BI, usar `lugar` como campo de ubicación con *Country* = Honduras para que geocodifique bien.

- **Mapa de proveedores** (burbuja por pueblo, tamaño = cantidad comprada) — va a mostrar concentración en los departamentos cafetaleros reales: La Paz, Copán, Comayagua, Santa Bárbara, El Paraíso, Ocotepeque, Intibucá, Yoro, Lempira, Olancho.
- **Mapa de clientes**: los `distribuidor` y buena parte de `cafeteria_grande` están ubicados a propósito en Tegucigalpa, San Pedro Sula y La Ceiba (más realista — el comprador grande suele estar en la ciudad, no en la finca); el resto sigue el departamento de la bodega.
- **`tenants` no tiene columna de ubicación propia** (el nombre de la bodega ya sugiere la zona, ej. "Cooperativa Cafetalera Marcala"). Si querés un mapa por bodega en vez de por proveedor/cliente individual, armá una tabla chica manual en Power BI (Introducir datos) con esta relación tenant → departamento:

| tenant_id | nombre | departamento |
|---|---|---|
| 5 | Bodega de Prueba | La Paz |
| 8 | Cooperativa Cafetalera Marcala | La Paz |
| 9 | Beneficio San Jose de Copan | Copán |
| 10 | Bodega Montanas de Comayagua | Comayagua |
| 11 | Cafes del Paraiso | El Paraíso |
| 12 | Beneficio Santa Barbara | Santa Bárbara |
| 13 | Bodega Don Fabio - Ocotepeque | Ocotepeque |
| 14 | Cafe Intibuca Organico | Intibucá |
| 15 | Bodega Yorito Verde | Yoro |
| 16 | Cafetalera Gracias - Lempira | Lempira |
| 17 | Bodega El Roble - Olancho | Olancho |
| 18 | Cafe Siguatepeque | Comayagua |

### 5.6 Actividad / auditoría

- **Volumen de operaciones por usuario** (`bitacora` agrupado por `usuario_id`/`tabla_afectada_id`) — útil para un dashboard operativo de "quién está usando el sistema y para qué".
- **Actividad por tabla** (compras vs ventas vs procesamiento vs altas de proveedor/cliente) en el tiempo.

---

## 6. Notas finales

- El free tier de Supabase tiene 500 MB de storage — la base ocupa hoy ~165 MB (33%). Esto no afecta a Power BI en modo Import (solo lee, no escribe), pero es contexto por si alguien pregunta por qué no hay más datos.
- Si en algún momento el conteo de filas cambia (se agregan más bodegas, más historial, etc.), no hace falta tocar este documento — el modelo de tablas/relaciones es el mismo, solo cambia el volumen.
- Cualquier duda sobre qué significa un campo específico que no esté acá, `CONTEXTO-FRONTEND.md` y `CONTEXTO-SEED-DATA.md` (en este mismo repo) tienen el detalle completo de cada tabla y las reglas de negocio.
