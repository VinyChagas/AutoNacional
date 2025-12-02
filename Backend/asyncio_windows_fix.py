"""
Fix para configuração do asyncio no Windows para suportar subprocessos do Playwright.

Este módulo deve ser importado ANTES de qualquer outra coisa no Windows para garantir
que o ProactorEventLoop seja usado, permitindo que o Playwright crie subprocessos.

Uso:
    No início do main.py, antes de qualquer import:
        import asyncio_windows_fix  # Configura o loop policy no Windows
"""

import sys
import platform
import asyncio

if platform.system() == "Windows":
    try:
        # Configura a política de loop para usar ProactorEventLoop no Windows
        # O ProactorEventLoop suporta subprocessos, que o Playwright precisa
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        print(f"[asyncio_fix] ✅ ProactorEventLoop configurado para Windows (Python {sys.version_info.major}.{sys.version_info.minor})")
    except (AttributeError, RuntimeError) as e:
        # Se falhar, tenta continuar (pode já estar configurado)
        print(f"[asyncio_fix] ⚠️  Não foi possível configurar ProactorEventLoop: {e}")
        # Python 3.8+ já usa ProactorEventLoop por padrão no Windows, mas vamos garantir
        pass

