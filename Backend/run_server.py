"""
Script personalizado para iniciar o servidor uvicorn no Windows.
Este script configura o ProactorEventLoop ANTES de uvicorn iniciar o loop de eventos,
garantindo que subprocessos do Playwright funcionem corretamente.
"""

import sys
import platform
import asyncio

# IMPORTANTE: Configura o event loop policy ANTES de importar uvicorn
# Isso garante que o ProactorEventLoop seja usado, permitindo subprocessos no Windows
if platform.system() == "Windows":
    try:
        # Define a política de loop para usar ProactorEventLoop no Windows
        # O ProactorEventLoop suporta subprocessos, que o Playwright precisa
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        print(f"[run_server] ✅ ProactorEventLoop configurado para Windows (Python {sys.version_info.major}.{sys.version_info.minor})")
    except (AttributeError, RuntimeError) as e:
        # Se falhar, tenta continuar
        print(f"[run_server] ⚠️  Não foi possível configurar ProactorEventLoop: {e}")
        print(f"[run_server] Continuando mesmo assim...")

# Agora importa e executa uvicorn
if __name__ == "__main__":
    import uvicorn
    
    # Lê argumentos da linha de comando ou usa valores padrão
    host = "0.0.0.0"
    port = 8000
    # IMPORTANTE: No Windows, desabilita reload por padrão para evitar problemas com event loop policy
    # O reload cria processos filhos que podem não herdar a política corretamente
    # Use --reload explicitamente se realmente precisar
    reload = False
    if "--reload" in sys.argv:
        reload = True
    
    # Verifica argumentos da linha de comando
    if "--host" in sys.argv:
        idx = sys.argv.index("--host")
        if idx + 1 < len(sys.argv):
            host = sys.argv[idx + 1]
    
    if "--port" in sys.argv:
        idx = sys.argv.index("--port")
        if idx + 1 < len(sys.argv):
            port = int(sys.argv[idx + 1])
    
    if "--no-reload" in sys.argv:
        reload = False
    
    print(f"[run_server] 🚀 Iniciando uvicorn...")
    print(f"[run_server]    Host: {host}")
    print(f"[run_server]    Port: {port}")
    print(f"[run_server]    Reload: {reload}")
    print()
    
    # Executa uvicorn programaticamente
    # Isso garante que o event loop policy já está configurado
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info"
    )
