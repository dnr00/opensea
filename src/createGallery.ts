import { ethers } from 'ethers';
import { FordefiWeb3Provider, FordefiProviderConfig, EvmChainId } from "@fordefi/web3-provider";
import { OpenSeaSDK, Chain } from 'opensea-js';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';

// 환경 변수 로드
dotenv.config();

/**
 * 환경 변수 및 설정 값
 */
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const OPENSEA_GRAPHQL_URL = 'https://gql.opensea.io/graphql';
const PEM_KEY_PATH = '/Users/sangwook/workspace/typescript/opensea/private.pem';

/**
 * 갤러리 생성을 위한 인터페이스 정의
 */
interface GalleryItem {
  chain: string;
  contractAddress: string;
  tokenId: string;
}

interface CreateGalleryInput {
  title: string;
  description: string;
  items: GalleryItem[];
}

/**
 * Fordefi Provider 설정 및 초기화
 */
class FordefiProviderManager {
  provider: FordefiWeb3Provider;
  ethersProvider: ethers.BrowserProvider | ethers.JsonRpcProvider;
  signer!: ethers.Signer; // 초기화는 connect()에서 수행되므로 입력 부호 추가
  walletAddress: string;
  
  constructor() {
    const pemKey = fs.readFileSync(PEM_KEY_PATH, 'utf8') ?? 
      (() => { throw new Error('PEM 키를 읽을 수 없습니다') })();
    
    const config: FordefiProviderConfig = {
      chainId: EvmChainId.NUMBER_8453, // Base
      address: "0x2A7fb76E6EC0a3b329Ac3AB94dBdbAB2F0cC5c8e",
      apiUserToken: process.env.FORDEFI_API_USER_TOKEN!,
      apiPayloadSignKey: pemKey,
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/sA2ayOK8MT4fMosd38djWYYseUK8toHM"
    };
    
    this.walletAddress = config.address;
    this.provider = new FordefiWeb3Provider(config);
    
    // ethers v6 변경사항 반영
    this.ethersProvider = new ethers.BrowserProvider(this.provider as any);
  }
  
  /**
   * EIP-1193 이벤트 등록 및 Provider 연결
   */
  async connect() {
    // 이벤트 리스너 등록
    this.provider.on('connect', (connectInfo: { chainId: string }) => {
      console.log(`Provider 연결됨, 체인 ID: ${connectInfo.chainId}`);
    });
    
    this.provider.on('disconnect', (error: { code: number; message: string }) => {
      console.error(`Provider 연결 해제됨: ${error.message}`);
    });
    
    // Provider 연결
    console.log("Fordefi Provider에 연결 중...");
    await this.provider.connect();
    console.log("Fordefi Provider에 성공적으로 연결됨");
    
    // ethers v6에서는 getSigner()가 Promise를 반환
    this.signer = await this.ethersProvider.getSigner();
    const address = await this.signer.getAddress();
    console.log(`사용 중인 지갑 주소: ${address}`);
    
    return this.signer;
  }
  
  /**
   * Provider 연결 해제
   */
  async disconnect() {
    await this.provider.disconnect();
    console.log("Fordefi Provider 연결 해제됨");
  }
}

/**
 * OpenSea 갤러리 관리 클래스
 */
class OpenSeaGalleryManager {
  private signer: ethers.Signer;
  walletAddress: string;
  
  constructor(signer: ethers.Signer, walletAddress: string) {
    this.signer = signer;
    this.walletAddress = walletAddress;
    console.log('OpenSea 갤러리 관리자 초기화 완료');
  }
  
  /**
   * OpenSea GraphQL API를 사용하여 갤러리 생성 요청을 보냅니다
   * @param input 갤러리 생성에 필요한 정보
   * @returns API 응답 결과
   */
  async createGallery(input: CreateGalleryInput): Promise<any> {
    try {
      // 사용자 인증 확인 - 지갑 주소 사용
      console.log('인증된 지갑 주소:', this.walletAddress);
      
      // GraphQL 쿼리 및 변수 설정
      const query = `
        mutation CreateProfileShelfMutation($input: CreateProfileShelfInput!) {
          createProfileShelf(input: $input) {
            success
            error {
              __typename
            }
            __typename
          }
        }
      `;

      const variables = {
        input: {
          title: input.title,
          description: input.description,
          items: input.items
        }
      };

      console.log('요청 URL:', OPENSEA_GRAPHQL_URL);
      console.log('요청 변수:', JSON.stringify(variables, null, 2));
      
      // 인증된 요청 생성
      const headers = {
        'Content-Type': 'application/json',
        'X-API-KEY': OPENSEA_API_KEY
      };
      
      // 지갑 서명을 위한 메세지 포맷
      const message = `OpenSea API 요청:
${OPENSEA_GRAPHQL_URL}
${JSON.stringify(variables)}`;      
      console.log('서명할 메세지:', message);
      
      // 지갑 서명 처리 - ethers의 Signer 객체를 통해 직접 서명
      const signature = await this.signer.signMessage(message);
      console.log('서명 값:', signature);
      
      // 서명 헤더 추가
      const authHeaders = {
        ...headers,
        'X-AUTH-SIGNATURE': signature,
        'X-AUTH-WALLET': this.walletAddress
      };
      
      const response = await axios.post(
        OPENSEA_GRAPHQL_URL,
        {
          query,
          variables
        },
        { headers: authHeaders }
      );
      
      console.log('응답 상태 코드:', response.status);

      // 응답 확인
      if (response.data.errors) {
        console.error('갤러리 생성 오류:', response.data.errors);
        return { success: false, errors: response.data.errors };
      }

      console.log('갤러리가 성공적으로 생성되었습니다:', response.data.data);
      return response.data.data;
    } catch (error: any) {
      console.error('갤러리 생성 중 에러 발생:', error.message);
      if (error.response) {
        console.error('응답 상태:', error.response.status);
        console.error('응답 데이터:', error.response.data);
        console.error('응답 헤더:', error.response.headers);
      }
      return { success: false, error: error.message };
    }
  }
}

/**
 * 메인 함수: 갤러리 생성 실행
 */
async function main() {
  console.log('OpenSea API 키:', OPENSEA_API_KEY ? '설정됨' : '설정되지 않음');
  
  // 갤러리에 추가할 NFT 정보
  const galleryInput: CreateGalleryInput = {
    title: "thc",
    description: "",
    items: [
      {
        chain: "bera_chain",
        contractAddress: "0x229f67d36bf9beb006302d800ccef660d75ba339",
        tokenId: "2792"
      }
    ]
  };
  
  console.log('갤러리 생성 입력값:', JSON.stringify(galleryInput, null, 2));

  try {
    // 1. Fordefi Provider 초기화 및 연결
    console.log('Fordefi Provider 초기화 중...');
    const fordefiManager = new FordefiProviderManager();
    const signer = await fordefiManager.connect();
    
    // 2. OpenSea SDK 초기화
    console.log('OpenSea 갤러리 관리자 초기화 중...');
    const galleryManager = new OpenSeaGalleryManager(signer, fordefiManager.walletAddress);
    
    // 3. 갤러리 생성 실행
    console.log('갤러리 생성을 시작합니다...');
    const result = await galleryManager.createGallery(galleryInput);
    
    if (result.createProfileShelf?.success) {
      console.log('갤러리가 성공적으로 생성되었습니다!');
    } else {
      console.error('갤러리 생성 실패:', result.createProfileShelf?.error || '알 수 없는 오류');
    }
    
    // 4. 연결 해제
    await fordefiManager.disconnect();
  } catch (error) {
    console.error('실행 중 오류 발생:', error);
  }
}

// 스크립트 실행
main().catch(console.error);