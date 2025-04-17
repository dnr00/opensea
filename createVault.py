import requests
import os
import time
import json
import argparse
from dotenv import load_dotenv

def create_vault(name, vault_group_id, vault_type="evm"):
    """
    특정 이름과 그룹으로 Fordefi Vault를 생성합니다.
    
    Args:
        name (str): 생성할 볼트의 이름
        vault_group_id (str): 볼트를 생성할 그룹 ID
        vault_type (str): 볼트 유형, 기본값은 "evm"
        
    Returns:
        dict: API 응답 데이터
    """
    url = "https://api.fordefi.com/api/v1/vaults"
    
    payload = {
        "name": name,
        "vault_group_id": vault_group_id,
        "type": vault_type
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {bearer_auth_token}"
    }
    
    response = requests.post(url, json=payload, headers=headers)
    
    if response.status_code == 200 or response.status_code == 201:
        response_data = response.json()
        print(f"✅ 볼트 '{name}' 생성 성공! 주소: {response_data.get('address', 'N/A')}")
        return response_data
    else:
        print(f"❌ 볼트 '{name}' 생성 실패: {response.status_code}")
        print(response.text)
        return None

def create_multiple_vaults(prefix, start_num, end_num, vault_group_id, output_file, digits=4, delay=1):
    """
    지정된 범위 내에서 여러 개의 볼트를 순차적으로 생성합니다.
    
    Args:
        prefix (str): 볼트 이름의 접두사
        start_num (int): 시작 번호
        end_num (int): 끝 번호
        vault_group_id (str): 볼트를 생성할 그룹 ID
        output_file (str): 결과를 저장할 JSON 파일 경로
        digits (int): 번호의 자릿수 (예: 4는 '0001'과 같이 표시)
        delay (int): 각 요청 사이의 지연 시간(초)
    """
    successful = 0
    failed = 0
    vault_data_list = []
    
    for num in range(start_num, end_num + 1):
        # 번호를 지정된 자릿수에 맞게 포맷팅
        formatted_num = str(num).zfill(digits)
        vault_name = f"{prefix} {formatted_num}"
        
        print(f"\n[{num-start_num+1}/{end_num-start_num+1}] 볼트 생성 중: {vault_name}")
        
        result = create_vault(vault_name, vault_group_id)
        
        if result:
            successful += 1
            # 응답 데이터에서 name과 address 추출하여 저장
            vault_data = {
                "name": result.get("name"),
                "address": result.get("address")
            }
            vault_data_list.append(vault_data)
        else:
            failed += 1
        
        # 마지막 요청이 아니면 지연 시간을 둠
        if num < end_num:
            print(f"다음 요청까지 {delay}초 대기 중...")
            time.sleep(delay)
    
    # 수집된 볼트 데이터를 JSON 파일로 저장
    if vault_data_list:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(vault_data_list, f, indent=2, ensure_ascii=False)
        print(f"📄 볼트 데이터가 '{output_file}' 파일에 저장되었습니다.")
    
    print(f"\n===== 볼트 생성 완료 =====")
    print(f"성공: {successful}, 실패: {failed}, 총 시도: {end_num - start_num + 1}")
    
    return vault_data_list

if __name__ == "__main__":
    # 명령줄 인자 파싱을 위한 ArgumentParser 설정
    parser = argparse.ArgumentParser(description='Fordefi 볼트를 연속적으로 생성합니다.')
    parser.add_argument('--prefix', type=str, default='Airdrop Opensea',
                        help='볼트 이름의 접두사 (기본값: "Airdrop Opensea")')
    parser.add_argument('--start', type=int, default=1,
                        help='시작 번호 (기본값: 1)')
    parser.add_argument('--end', type=int, default=10,
                        help='끝 번호 (기본값: 10)')
    parser.add_argument('--group', type=str, default='6898ebb4-2bb3-4e55-a8d7-e9722acfe2f9',
                        help='볼트 그룹 ID (기본값: "6898ebb4-2bb3-4e55-a8d7-e9722acfe2f9")')
    parser.add_argument('--digits', type=int, default=4,
                        help='번호의 자릿수 (기본값: 4, 예: "0001")')
    parser.add_argument('--delay', type=int, default=1,
                        help='각 요청 사이의 지연 시간(초) (기본값: 1)')
    parser.add_argument('--output', type=str, default='vaults.json',
                        help='결과를 저장할 JSON 파일 경로 (기본값: "vaults.json")')
    
    args = parser.parse_args()
    
    # .env 파일 로드
    load_dotenv()
    bearer_auth_token = os.getenv('FORDEFI_API_USER_TOKEN')
    
    if not bearer_auth_token:
        print("❌ 오류: FORDEFI_API_USER_TOKEN이 .env 파일에 설정되지 않았습니다.")
        exit(1)
    
    print(f"🚀 {args.prefix} {str(args.start).zfill(args.digits)}부터 {args.prefix} {str(args.end).zfill(args.digits)}까지 볼트 생성을 시작합니다.")
    print(f"📑 결과는 '{args.output}' 파일에 저장됩니다.")
    
    # 볼트 생성 함수 호출
    create_multiple_vaults(
        prefix=args.prefix,
        start_num=args.start,
        end_num=args.end,
        vault_group_id=args.group,
        output_file=args.output,
        digits=args.digits,
        delay=args.delay
    )