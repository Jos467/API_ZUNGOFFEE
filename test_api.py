"""
Pruebas automatizadas de la API de bodegas de café.
Ejecuta cada endpoint en orden, encadena los IDs que van saliendo,
valida el resultado esperado, y genera un reporte en Markdown para el informe.
Requisitos: Python 3.9+, paquete `requests`.
"""
import json
import sys
from datetime import datetime
import requests
# ============ CONFIGURACIÓN -- edita esto con tus datos reales ============
SUPABASE_URL = "https://tagmxyqqnwttcqisiqvo.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhZ214eXFxbnd0dGNxaXNpcXZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1MTQyNDYsImV4cCI6MjEwMDA5MDI0Nn0.KGV-zluaRwZVKFn0pokzjPBPvYvDNK1dXwi7x2kp1u0"
EMAIL = "admin1@test.com"
PASSWORD = "admin123"
API_BASE = "http://localhost:3000"
# ===========================================================================

resultados = []

def registrar(paso, metodo, url, payload, resp, ok, motivo):
    resultados.append({
        "paso": paso, "metodo": metodo, "url": url, "payload": payload,
        "status": resp.status_code if resp is not None else "N/A",
        "body": resp.text if resp is not None else "(sin respuesta)",
        "ok": ok, "motivo": motivo,
    })
    marca = "PASS" if ok else "FAIL"
    print(f"[{marca}] [{resp.status_code if resp is not None else '---'}] {paso} -- {motivo}")

def paso(nombre, metodo, url, headers, payload=None, params=None):
    try:
        resp = requests.request(metodo, url, headers=headers, json=payload, params=params, timeout=15)
        return resp
    except requests.RequestException as e:
        print(f"ERROR de conexión en '{nombre}': {e}")
        registrar(nombre, metodo, url, payload, None, False, f"Error de conexión: {e}")
        return None

def login():
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": ANON_KEY, "Content-Type": "application/json"},
        json={"email": EMAIL, "password": PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        print("No se pudo iniciar sesión en Supabase. Revisa ANON_KEY / EMAIL / PASSWORD.")
        print(r.text)
        sys.exit(1)
    return r.json()["access_token"]

def main():
    print("== 1. Login ==")
    token = login()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    print("Login OK, token obtenido.\n")

    print("== 2. Proveedor ==")
    r = paso("Crear proveedor", "POST", f"{API_BASE}/proveedores", headers,
              {"nombre": "Don Chepe Martinez", "lugar": "Marcala", "finca": "Finca El Roble"})
    proveedor_id = None
    if r is not None and r.status_code == 201:
        proveedor_id = r.json()["id"]
        registrar("Crear proveedor", "POST", f"{API_BASE}/proveedores", None, r, True, "201 Created")
    else:
        registrar("Crear proveedor", "POST", f"{API_BASE}/proveedores", None, r, False, "esperaba 201")

    print("\n== 3. Compra (dispara trigger de lote) ==")
    lote_origen_id = None
    if proveedor_id:
        payload = {"proveedorId": proveedor_id, "lineas": [
            {"estadoCafeId": 3, "variedadId": 1, "alturaId": 1, "humedad": 11.5, "cantidad": 10, "costoUnitario": 120}
        ]}
        r = paso("Registrar compra", "POST", f"{API_BASE}/compras", headers, payload)
        registrar("Registrar compra", "POST", f"{API_BASE}/compras", payload, r, r is not None and r.status_code == 201,
                  "201 Created" if r is not None and r.status_code == 201 else "esperaba 201")

        r = paso("Ver existencias tras compra", "GET", f"{API_BASE}/lotes/existencias", headers)
        if r is not None and r.status_code == 200:
            lotes = r.json()
            nuevo_lote = max(lotes, key=lambda l: int(l["id"])) if lotes else None
            ok = nuevo_lote is not None and float(nuevo_lote["saldo"]) == 10.0
            registrar("Existencias tras compra", "GET", f"{API_BASE}/lotes/existencias", None, r, ok,
                      "saldo=10.00 (trigger creó el lote)" if ok else "no se creó el lote esperado")
            if nuevo_lote:
                lote_origen_id = nuevo_lote["id"]
        else:
            registrar("Existencias tras compra", "GET", f"{API_BASE}/lotes/existencias", None, r, False,
                      f"esperaba 200, llegó {r.status_code if r else 'sin respuesta'}")
    else:
        print("Se saltan pruebas de compra: no hay proveedor_id.")

    print("\n== 4. Procesamiento (tueste) ==")
    lote_destino_id = None
    if lote_origen_id:
        payload = {"loteOrigenId": int(lote_origen_id), "estadoDestinoId": 5, "cantidadEntrada": 5, "cantidadSalida": 350}
        r = paso("Registrar procesamiento", "POST", f"{API_BASE}/procesamiento", headers, payload)
        if r is not None and r.status_code == 201:
            lote_destino_id = r.json()["lote_destino"]["id"]
            registrar("Registrar procesamiento", "POST", f"{API_BASE}/procesamiento", payload, r, True, "201 Created")
        else:
            registrar("Registrar procesamiento", "POST", f"{API_BASE}/procesamiento", payload, r, False, "esperaba 201")

        r = paso("Ver existencias tras procesamiento", "GET", f"{API_BASE}/lotes/existencias", headers)
        if r is not None and r.status_code == 200:
            lotes = r.json()
            ok = len(lotes) >= 2
            registrar("Existencias tras procesamiento", "GET", f"{API_BASE}/lotes/existencias", None, r, ok,
                      "2 lotes (origen con saldo reducido + derivado)" if ok else "no aparece el lote derivado")
        else:
            registrar("Existencias tras procesamiento", "GET", f"{API_BASE}/lotes/existencias", None, r, False,
                      f"esperaba 200, llegó {r.status_code if r else 'sin respuesta'}")
    else:
        print("Se saltan pruebas de procesamiento: no hay lote_origen_id.")

    print("\n== 5. Cliente y venta ==")
    cliente_id = None
    r = paso("Crear cliente", "POST", f"{API_BASE}/clientes", headers,
              {"nombre": "Cafeteria El Buen Cafe", "tipoId": 2, "lugar": "Tegucigalpa"})
    if r is not None and r.status_code == 201:
        cliente_id = r.json()["id"]
        registrar("Crear cliente", "POST", f"{API_BASE}/clientes", None, r, True, "201 Created")
    else:
        registrar("Crear cliente", "POST", f"{API_BASE}/clientes", None, r, False, "esperaba 201")

    if cliente_id and lote_destino_id:
        payload = {"clienteId": cliente_id, "lineas": [{"loteId": int(lote_destino_id), "cantidad": 100, "precioUnitario": 3.5}]}
        r = paso("Registrar venta válida", "POST", f"{API_BASE}/ventas", headers, payload)
        registrar("Registrar venta válida", "POST", f"{API_BASE}/ventas", payload, r, r is not None and r.status_code == 201,
                  "201 Created" if r is not None and r.status_code == 201 else "esperaba 201")

        payload_mala = {"clienteId": cliente_id, "lineas": [{"loteId": int(lote_destino_id), "cantidad": 9999, "precioUnitario": 3.5}]}
        r = paso("Venta con saldo insuficiente (debe fallar)", "POST", f"{API_BASE}/ventas", headers, payload_mala)
        registrar("Venta con saldo insuficiente", "POST", f"{API_BASE}/ventas", payload_mala, r, r is not None and r.status_code == 400,
                  "400 Bad Request (saldo insuficiente)" if r is not None and r.status_code == 400 else "debía dar 400")
    else:
        print("Se saltan pruebas de venta: falta cliente_id o lote_destino_id.")

    print("\n== 6. Reportes y bitácora ==")
    r = paso("Reporte de inventario", "GET", f"{API_BASE}/reportes/inventario", headers)
    registrar("Reporte de inventario", "GET", f"{API_BASE}/reportes/inventario", None, r, r is not None and r.status_code == 200, "200 OK")

    r = paso("Reporte de ventas por rango", "GET", f"{API_BASE}/reportes/ventas", headers,
              params={"desde": "2026-01-01", "hasta": "2026-12-31"})
    registrar("Reporte de ventas por rango", "GET", f"{API_BASE}/reportes/ventas", None, r, r is not None and r.status_code == 200, "200 OK")

    r = paso("Bitácora", "GET", f"{API_BASE}/bitacora", headers)
    if r is not None and r.status_code == 200:
        ok = len(r.json()) >= 1
        registrar("Bitácora", "GET", f"{API_BASE}/bitacora", None, r, ok,
                  "contiene registros de las acciones anteriores" if ok else "vino vacía, se esperaban registros")
    else:
        registrar("Bitácora", "GET", f"{API_BASE}/bitacora", None, r, False, "esperaba 200")

    print("\n== 7. Paginación ==")
    r = paso("Compras paginadas", "GET", f"{API_BASE}/compras", headers, params={"page": 1, "pageSize": 5})
    if r is not None and r.status_code == 200:
        ok = len(r.json()) <= 5
        registrar("Compras paginadas", "GET", f"{API_BASE}/compras", None, r, ok,
                  "<=5 resultados" if ok else "devolvió más de pageSize")

    print("\n== 8. Prueba de permisos (debe fallar con 403) ==")
    r = paso("Acceso a /tenants con rol no autorizado", "GET", f"{API_BASE}/tenants", headers)
    es_403 = (r is not None) and (r.status_code == 403)
    motivo = "403 Forbidden (RolesGuard funcionando)" if es_403 else "debía dar 403 (revisa el rol del usuario de prueba)"
    registrar("Acceso a /tenants (rol incorrecto)", "GET", f"{API_BASE}/tenants", None, r, es_403, motivo)

    print("\n== 9. Nuevos endpoints (solicitudes, catálogos, resumen de ventas) ==")
    r = paso("Crear solicitud de registro (público, sin token)", "POST", f"{API_BASE}/solicitudes", {"Content-Type": "application/json"},
              {"nombreBodega": "Bodega de prueba", "nombreContacto": "Juan Perez", "email": "juan@example.com"})
    registrar("Crear solicitud de registro", "POST", f"{API_BASE}/solicitudes", None, r, r is not None and r.status_code == 201,
              "201 Created" if r is not None and r.status_code == 201 else "esperaba 201")

    r = paso("Catálogos", "GET", f"{API_BASE}/catalogos", headers)
    registrar("Catálogos", "GET", f"{API_BASE}/catalogos", None, r, r is not None and r.status_code == 200, "200 OK")

    r = paso("Resumen de ventas", "GET", f"{API_BASE}/ventas/resumen", headers)
    registrar("Resumen de ventas", "GET", f"{API_BASE}/ventas/resumen", None, r, r is not None and r.status_code == 200, "200 OK")

    escribir_reporte()

def escribir_reporte():
    nombre_archivo = f"reporte_pruebas_{datetime.now():%Y%m%d_%H%M%S}.md"
    total = len(resultados)
    pasaron = sum(1 for r in resultados if r["ok"])
    with open(nombre_archivo, "w", encoding="utf-8") as f:
        f.write(f"# Reporte de pruebas — API Zungo Coffee\n\n")
        f.write(f"**Fecha:** {datetime.now():%Y-%m-%d %H:%M:%S}\n\n")
        f.write(f"**Resultado global:** {pasaron}/{total} pruebas pasaron\n\n")
        f.write("| # | Prueba | Método | Status | Resultado | Motivo |\n")
        f.write("|---|---|---|---|---|---|\n")
        for i, r in enumerate(resultados, 1):
            marca = "OK" if r["ok"] else "FAIL"
            f.write(f"| {i} | {r['paso']} | {r['metodo']} | {r['status']} | {marca} | {r['motivo']} |\n")
        f.write("\n---\n\n## Detalle de cada petición\n\n")
        for r in resultados:
            f.write(f"### {r['paso']}\n")
            f.write(f"- **Endpoint:** `{r['metodo']} {r['url']}`\n")
            if r["payload"]:
                f.write(f"- **Payload enviado:**\n```json\n{json.dumps(r['payload'], indent=2, ensure_ascii=False)}\n```\n")
            f.write(f"- **Status recibido:** {r['status']}\n")
            f.write(f"- **Respuesta:**\n```json\n{r['body']}\n```\n\n")

    print(f"\n{'='*50}")
    print(f"RESULTADO: {pasaron}/{total} pruebas pasaron")
    print(f"Reporte guardado en: {nombre_archivo}")
    print(f"{'='*50}")

if __name__ == "__main__":
    main()
