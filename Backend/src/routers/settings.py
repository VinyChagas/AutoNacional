"""
Endpoints FastAPI para gerenciamento de configurações de automação.

Este módulo fornece endpoints REST para obter e atualizar
as configurações globais da automação NFSe.
"""

from fastapi import APIRouter, HTTPException, Depends, status, Body
from sqlalchemy.orm import Session
from typing import Dict, Any

from ..db.session import get_db
from ..db.crud_settings import obter_configuracoes, atualizar_configuracoes_from_dict
from ..schemas.settings import (
    AutomationSettingsResponse,
    AutomationSettingsUpdate,
)
from ..infrastructure.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/settings", tags=["Configurações"])


@router.get(
    "",
    summary="Obter configurações de automação"
)
def get_settings(db: Session = Depends(get_db)):
    """
    Obtém as configurações globais da automação.
    
    Se não existirem configurações, cria com valores padrão.
    
    Returns:
        AutomationSettingsResponse com todas as configurações
        
    Raises:
        HTTPException: Se houver erro ao obter configurações
    """
    try:
        logger.info("Endpoint GET /api/settings chamado")
        
        configuracoes = obter_configuracoes(db)
        
        if not configuracoes:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Erro ao obter configurações"
            )
        
        # Converte para o formato esperado pelo frontend (camelCase)
        response_data = {
            "id": configuracoes.id,
            "headless": configuracoes.headless,
            "companyTimeoutSeconds": configuracoes.company_timeout_seconds,
            "maxRetriesPerStep": configuracoes.max_retries_per_step,
            "minActionDelayMs": configuracoes.min_action_delay_ms,
            "maxConcurrentBrowsers": configuracoes.max_concurrent_browsers,
            "defaultConcurrentBrowsers": configuracoes.default_concurrent_browsers,
            "browserLaunchDelayMs": configuracoes.browser_launch_delay_ms,
            "viewportPreset": configuracoes.viewport_preset,
            "viewportWidth": configuracoes.viewport_width,
            "viewportHeight": configuracoes.viewport_height,
            "downloadsBasePath": configuracoes.downloads_base_path,
            "downloadsPattern": configuracoes.downloads_pattern,
            "logsPath": configuracoes.logs_path,
            "tempPath": configuracoes.temp_path,
            "logLevel": configuracoes.log_level,
            "saveErrorScreenshots": configuracoes.save_error_screenshots,
            "generatePdfReport": configuracoes.generate_pdf_report,
            "logRetentionDays": configuracoes.log_retention_days,
            "maxErrorsInPanel": configuracoes.max_errors_in_panel,
        }
        
        # Retorna diretamente como dict para manter camelCase
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao obter configurações: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao obter configurações: {str(e)}"
        )


@router.put(
    "",
    summary="Atualizar configurações de automação"
)
def update_settings(
    settings: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db)
):
    """
    Atualiza as configurações globais da automação.
    
    Se não existirem configurações, cria com os valores fornecidos.
    
    Args:
        settings: Dados das configurações a atualizar
        
    Returns:
        AutomationSettingsResponse com as configurações atualizadas
        
    Raises:
        HTTPException: Se houver erro de validação ou ao salvar
    """
    try:
        logger.info("Endpoint PUT /api/settings chamado")
        
        # Converte camelCase do frontend para snake_case do backend
        settings_dict = {}
        if "headless" in settings:
            settings_dict["headless"] = settings["headless"]
        if "companyTimeoutSeconds" in settings:
            settings_dict["company_timeout_seconds"] = settings["companyTimeoutSeconds"]
        if "maxRetriesPerStep" in settings:
            settings_dict["max_retries_per_step"] = settings["maxRetriesPerStep"]
        if "minActionDelayMs" in settings:
            settings_dict["min_action_delay_ms"] = settings["minActionDelayMs"]
        if "maxConcurrentBrowsers" in settings:
            settings_dict["max_concurrent_browsers"] = settings["maxConcurrentBrowsers"]
        if "defaultConcurrentBrowsers" in settings:
            settings_dict["default_concurrent_browsers"] = settings["defaultConcurrentBrowsers"]
        if "browserLaunchDelayMs" in settings:
            settings_dict["browser_launch_delay_ms"] = settings["browserLaunchDelayMs"]
        if "viewportPreset" in settings:
            viewport_preset = settings["viewportPreset"]
            settings_dict["viewport_preset"] = viewport_preset
            # Validação: se viewport_preset for CUSTOM, viewport_width e viewport_height são obrigatórios
            if viewport_preset == "CUSTOM":
                if "viewportWidth" not in settings or "viewportHeight" not in settings:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="viewportWidth e viewportHeight são obrigatórios quando viewportPreset é CUSTOM"
                    )
                if settings.get("viewportWidth", 0) <= 0 or settings.get("viewportHeight", 0) <= 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="viewportWidth e viewportHeight devem ser maiores que 0"
                    )
                settings_dict["viewport_width"] = settings["viewportWidth"]
                settings_dict["viewport_height"] = settings["viewportHeight"]
            else:
                # Remove campos None para viewport quando não for CUSTOM
                settings_dict["viewport_width"] = None
                settings_dict["viewport_height"] = None
        if "downloadsBasePath" in settings:
            settings_dict["downloads_base_path"] = settings["downloadsBasePath"]
        if "downloadsPattern" in settings:
            settings_dict["downloads_pattern"] = settings["downloadsPattern"]
        if "logsPath" in settings:
            settings_dict["logs_path"] = settings["logsPath"]
        if "tempPath" in settings:
            settings_dict["temp_path"] = settings["tempPath"]
        if "logLevel" in settings:
            settings_dict["log_level"] = settings["logLevel"]
        if "saveErrorScreenshots" in settings:
            settings_dict["save_error_screenshots"] = settings["saveErrorScreenshots"]
        if "generatePdfReport" in settings:
            settings_dict["generate_pdf_report"] = settings["generatePdfReport"]
        if "logRetentionDays" in settings:
            settings_dict["log_retention_days"] = settings["logRetentionDays"]
        if "maxErrorsInPanel" in settings:
            settings_dict["max_errors_in_panel"] = settings["maxErrorsInPanel"]
        
        # Valida usando Pydantic antes de salvar (converte snake_case para validar)
        try:
            # Cria um dict temporário com snake_case para validação
            temp_dict = {}
            for key, value in settings_dict.items():
                temp_dict[key] = value
            validated_settings = AutomationSettingsUpdate(**temp_dict)
            # Usa os valores validados
            settings_dict = validated_settings.model_dump(exclude_unset=True)
        except Exception as e:
            logger.error(f"Erro de validação: {e}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Erro de validação: {str(e)}"
            )
        
        # Atualiza as configurações
        configuracoes = atualizar_configuracoes_from_dict(db, settings_dict)
        
        # Converte para resposta em camelCase (formato esperado pelo frontend)
        response_data = {
            "id": configuracoes.id,
            "headless": configuracoes.headless,
            "companyTimeoutSeconds": configuracoes.company_timeout_seconds,
            "maxRetriesPerStep": configuracoes.max_retries_per_step,
            "minActionDelayMs": configuracoes.min_action_delay_ms,
            "maxConcurrentBrowsers": configuracoes.max_concurrent_browsers,
            "defaultConcurrentBrowsers": configuracoes.default_concurrent_browsers,
            "browserLaunchDelayMs": configuracoes.browser_launch_delay_ms,
            "viewportPreset": configuracoes.viewport_preset,
            "viewportWidth": configuracoes.viewport_width,
            "viewportHeight": configuracoes.viewport_height,
            "downloadsBasePath": configuracoes.downloads_base_path,
            "downloadsPattern": configuracoes.downloads_pattern,
            "logsPath": configuracoes.logs_path,
            "tempPath": configuracoes.temp_path,
            "logLevel": configuracoes.log_level,
            "saveErrorScreenshots": configuracoes.save_error_screenshots,
            "generatePdfReport": configuracoes.generate_pdf_report,
            "logRetentionDays": configuracoes.log_retention_days,
            "maxErrorsInPanel": configuracoes.max_errors_in_panel,
        }
        
        logger.info("Configurações atualizadas com sucesso")
        return response_data
        
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Erro de validação: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Erro ao atualizar configurações: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao atualizar configurações: {str(e)}"
        )

